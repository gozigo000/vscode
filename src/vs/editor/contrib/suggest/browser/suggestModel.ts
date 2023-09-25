/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// * [개요] export
// * export interface ICancelEvent
// * export interface ITriggerEvent
// * export interface ISuggestEvent
// * export interface SuggestTriggerOptions
// * export class LineContext
// * export const enum State
// [*]export class `SuggestModel` implements IDisposable

import { TimeoutTimer } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { getLeadingWhitespace, isHighSurrogate, isLowSurrogate } from 'vs/base/common/strings';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { CursorChangeReason, ICursorSelectionChangedEvent } from 'vs/editor/common/cursorEvents';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel } from 'vs/editor/common/model';
import { CompletionContext, CompletionItemKind, CompletionItemProvider, CompletionTriggerKind } from 'vs/editor/common/languages';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorker';
import { WordDistance } from 'vs/editor/contrib/suggest/browser/wordDistance';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ILogService } from 'vs/platform/log/common/log';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { CompletionModel } from './completionModel';
import { CompletionDurations, CompletionItem, CompletionOptions, getSnippetSuggestSupport, provideSuggestionItems, QuickSuggestionsOptions, SnippetSortOrder } from './suggest';
import { IWordAtPosition } from 'vs/editor/common/core/wordHelper';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { FuzzyScoreOptions } from 'vs/base/common/filters';
import { assertType } from 'vs/base/common/types';
import { InlineCompletionContextKeys } from 'vs/editor/contrib/inlineCompletions/browser/inlineCompletionContextKeys';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export interface ICancelEvent {
	readonly retrigger: boolean;
}

export interface ITriggerEvent {
	readonly auto: boolean;
	readonly shy: boolean;
	readonly position: IPosition;
}

export interface ISuggestEvent {
	readonly completionModel: CompletionModel;
	readonly isFrozen: boolean;
	readonly triggerOptions: SuggestTriggerOptions;
}

export interface SuggestTriggerOptions {
	readonly auto: boolean;
	readonly shy?: boolean;
	readonly refilter?: boolean;
	readonly retrigger?: boolean;
	readonly triggerKind?: CompletionTriggerKind;
	readonly triggerCharacter?: string;
	readonly clipboardText?: string;
	completionOptions?: Partial<CompletionOptions>;
}

export class LineContext {

	static shouldAutoTrigger(editor: ICodeEditor): boolean {
		if (!editor.hasModel()) {
			return false;
		}
		const model = editor.getModel();
		const pos = editor.getPosition();
		model.tokenization.tokenizeIfCheap(pos.lineNumber);

		const word = model.getWordAtPosition(pos);
		if (!word) {
			return false;
		}
		if (word.endColumn !== pos.column &&
			word.startColumn + 1 !== pos.column /* after typing a single character before a word */) {
			return false;
		}
		if (!isNaN(Number(word.word))) {
			// 그냥 숫자만 있으면 제안 끄기?
			return false;
		}
		return true;
	}

	readonly lineNumber: number;
	readonly column: number;
	readonly leadingLineContent: string;
	readonly leadingWord: IWordAtPosition;
	readonly triggerOptions: SuggestTriggerOptions;

	constructor(model: ITextModel, position: Position, triggerOptions: SuggestTriggerOptions) {
		this.lineNumber = position.lineNumber;
		this.column = position.column;
		this.leadingLineContent = model.getLineContent(position.lineNumber).substr(0, position.column - 1);
		this.leadingWord = model.getWordUntilPosition(position);
		this.triggerOptions = triggerOptions;
	}
}

/** `Idle` = 0, `Manual` = 1, `Auto` = 2 */
export const enum State {
	Idle = 0,
	Manual = 1,
	Auto = 2
}

function canShowQuickSuggest(editor: ICodeEditor, contextKeyService: IContextKeyService, configurationService: IConfigurationService): boolean {
	if (!Boolean(contextKeyService.getContextKeyValue(InlineCompletionContextKeys.inlineSuggestionVisible.key))) {
		// Allow if there is no inline suggestion.
		return true;
	}
	const suppressSuggestions = contextKeyService.getContextKeyValue<boolean | undefined>(InlineCompletionContextKeys.suppressSuggestions.key);
	if (suppressSuggestions !== undefined) {
		return !suppressSuggestions;
	}
	return !editor.getOption(EditorOption.inlineSuggest).suppressSuggestions;
}

function canShowSuggestOnTriggerCharacters(editor: ICodeEditor, contextKeyService: IContextKeyService, configurationService: IConfigurationService): boolean {
	if (!Boolean(contextKeyService.getContextKeyValue('inlineSuggestionVisible'))) {
		// Allow if there is no inline suggestion.
		return true;
	}
	const suppressSuggestions = contextKeyService.getContextKeyValue<boolean | undefined>(InlineCompletionContextKeys.suppressSuggestions.key);
	if (suppressSuggestions !== undefined) {
		return !suppressSuggestions;
	}
	return !editor.getOption(EditorOption.inlineSuggest).suppressSuggestions;
}

export class SuggestModel implements IDisposable {

	private readonly _toDispose = new DisposableStore();
	private readonly _triggerCharacterListener = new DisposableStore();
	private readonly _triggerQuickSuggest = new TimeoutTimer();

	private _triggerState: SuggestTriggerOptions | undefined = undefined;
	private _requestToken?: CancellationTokenSource;
	private _context?: LineContext;
	private _currentSelection: Selection;

	private _completionModel: CompletionModel | undefined;
	private readonly _completionDisposables = new DisposableStore();
	private readonly _onDidCancel = new Emitter<ICancelEvent>();
	private readonly _onDidTrigger = new Emitter<ITriggerEvent>();
	private readonly _onDidSuggest = new Emitter<ISuggestEvent>();

	readonly onDidCancel: Event<ICancelEvent> = this._onDidCancel.event;
	readonly onDidTrigger: Event<ITriggerEvent> = this._onDidTrigger.event;
	readonly onDidSuggest: Event<ISuggestEvent> = this._onDidSuggest.event;

	constructor(
		private readonly _editor: ICodeEditor,
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IEnvironmentService private readonly _envService: IEnvironmentService,
	) {
		this._currentSelection = this._editor.getSelection() || new Selection(1, 1, 1, 1);

		// wire up various listeners
		this._toDispose.add(this._editor.onDidChangeModel(() => {
			// console.log('이벤트: onDidChangeModel')
			this._updateTriggerCharacters();
			this.cancel();
		}));
		this._toDispose.add(this._editor.onDidChangeModelLanguage(() => {
			// console.log('이벤트: onDidChangeModelLanguage')
			this._updateTriggerCharacters();
			this.cancel();
		}));
		this._toDispose.add(this._editor.onDidChangeConfiguration(() => {
			// console.log('이벤트: onDidChangeConfiguration')
			this._updateTriggerCharacters();
		}));
		this._toDispose.add(this._languageFeaturesService.completionProvider.onDidChange(() => {
			// console.log('이벤트: onDidChange')
			this._updateTriggerCharacters();
			this._updateActiveSuggestSession();
		}));

		this._toDispose.add(this._editor.onDidChangeCursorSelection(e => {
			// console.log('이벤트: onDidChangeCursorSelection - 커서 위치 이동 (순서:4)')
			this._onCursorChange(e);
		}));
		this._toDispose.add(this._editor.onDidChangeModelContent(() => {
			// console.log('이벤트: onDidChangeModelContent ---- 문서 내용 변경 (순서:3)')
			// allow-any-unicode-next-line (e.g. ¨ + u makes ü but just ¨ cannot be used for filtering)
			if (this._triggerState !== undefined) {
				this._refilterCompletionItems();
			}
		}));

		this._updateTriggerCharacters();
	}

	dispose(): void {
		dispose(this._triggerCharacterListener);
		dispose([this._onDidCancel, this._onDidSuggest, this._onDidTrigger, this._triggerQuickSuggest]);
		this._toDispose.dispose();
		this._completionDisposables.dispose();
		this.cancel();
	}

	private _updateTriggerCharacters(): void {
		this._triggerCharacterListener.clear();

		if (this._editor.getOption(EditorOption.readOnly)
			|| !this._editor.hasModel()
			|| !this._editor.getOption(EditorOption.suggestOnTriggerCharacters)) {

			return;
		}

		const supportsByTriggerCharacter = new Map<string, Set<CompletionItemProvider>>();
		for (const support of this._languageFeaturesService.completionProvider.all(this._editor.getModel())) {
			for (const ch of support.triggerCharacters || []) {
				let set = supportsByTriggerCharacter.get(ch);
				if (!set) {
					set = new Set();
					set.add(getSnippetSuggestSupport());
					supportsByTriggerCharacter.set(ch, set);
				}
				set.add(support);
			}
		}


		const checkTriggerCharacter = (text?: string) => {

			if (!canShowSuggestOnTriggerCharacters(this._editor, this._contextKeyService, this._configurationService)) {
				return;
			}

			if (LineContext.shouldAutoTrigger(this._editor)) {
				// don't trigger by trigger characters when this is a case for quick suggest
				return;
			}

			if (!text) {
				// came here from the compositionEnd-event
				const position = this._editor.getPosition()!;
				const model = this._editor.getModel()!;
				text = model.getLineContent(position.lineNumber).substr(0, position.column - 1);
			}

			let lastChar = '';
			if (isLowSurrogate(text.charCodeAt(text.length - 1))) {
				if (isHighSurrogate(text.charCodeAt(text.length - 2))) {
					lastChar = text.substr(text.length - 2);
				}
			} else {
				lastChar = text.charAt(text.length - 1);
			}

			const supports = supportsByTriggerCharacter.get(lastChar);
			if (supports) {

				// keep existing items that where not computed by the
				// supports/providers that want to trigger now
				const providerItemsToReuse = new Map<CompletionItemProvider, CompletionItem[]>();
				if (this._completionModel) {
					for (const [provider, items] of this._completionModel.getItemsByProvider()) {
						if (!supports.has(provider)) {
							providerItemsToReuse.set(provider, items);
						}
					}
				}

				this.trigger({
					auto: true,
					triggerKind: CompletionTriggerKind.TriggerCharacter,
					triggerCharacter: lastChar,
					retrigger: Boolean(this._completionModel),
					clipboardText: this._completionModel?.clipboardText,
					completionOptions: { providerFilter: supports, providerItemsToReuse }
				});
			}
		};

		this._triggerCharacterListener.add(this._editor.onDidType(checkTriggerCharacter));
		this._triggerCharacterListener.add(this._editor.onDidCompositionEnd(() => checkTriggerCharacter()));
	}

	// --- 제안 trigger/retrigger/cancel

	/** triggerState 반환 */
	get state(): State {
		if (!this._triggerState) {
			return State.Idle;
		} else if (!this._triggerState.auto) {
			return State.Manual;
		} else {
			return State.Auto;
		}
	}

	/** 제안 취소하기 */
	cancel(retrigger: boolean = false): void {
		if (this._triggerState !== undefined) {
			this._triggerQuickSuggest.cancel();
			this._requestToken?.cancel();
			this._requestToken = undefined;
			this._triggerState = undefined;
			this._completionModel = undefined;
			this._context = undefined;
			this._onDidCancel.fire({ retrigger });
		}
	}

	clear() {
		this._completionDisposables.clear();
	}

	private _updateActiveSuggestSession(): void {
		if (this._triggerState !== undefined) {
			if (!this._editor.hasModel() || !this._languageFeaturesService.completionProvider.has(this._editor.getModel())) {
				this.cancel();
			} else {
				this.trigger({ auto: this._triggerState.auto, retrigger: true });
			}
		}
	}

	private _onCursorChange(e: ICursorSelectionChangedEvent): void {
		// console.log('_onCursorChange(e) 호출')
		if (!this._editor.hasModel()) {
			return;
		}

		const prevSelection = this._currentSelection;
		this._currentSelection = this._editor.getSelection();

		if (!e.selection.isEmpty() // 선택범위가 있거나,
			|| (e.reason !== CursorChangeReason.NotSet && e.reason !== CursorChangeReason.Explicit) // NotSet 또는 Explicit이 아니거나,
			|| (e.source !== 'keyboard' && e.source !== 'deleteLeft') // keyboard 또는 deleteLeft가 아니면, 나가기
		) {
			// Early exit if nothing needs to be done!
			// Leave some form of early exit check here if you wish to continue being a cursor position change listener ;)
			this.cancel();
			return;
		}

		if (this._triggerState === undefined && e.reason === CursorChangeReason.NotSet) {
			// 제안이 트리거된 적 없고, NotSet인 경우
			if (prevSelection.containsRange(this._currentSelection)
				|| prevSelection.getEndPosition().isBeforeOrEqual(this._currentSelection.getPosition())
			) {
				// 커서는 타이핑 때문에 `오른쪽`으로 이동한 것 -> 빠른 제안 트리거!
				// console.log('_onCursorChange(e) - 타이핑으로 커서 오른쪽으로 이동 -> 빠른 제안 트리거!')
				this._doTriggerQuickSuggest();
			}
		} else if (this._triggerState !== undefined && e.reason === CursorChangeReason.Explicit) {
			// 제안이 켜져 있고, 방향키 등으로 커서를 움직인 경우
			// (my. 백스페이스키 늘러서 커서가 이동한 경우는 포함되지 않음)
			// 현재 위치에서 리필터링하기
			// console.log('_onCursorChange(e) - 제안이 활성화 중이고 방향키 등으로 커서 이동 -> 리필터')
			this._refilterCompletionItems();
		}
	}

	/** 빠른 제안 트리거 준비 */
	private _doTriggerQuickSuggest(): void {
		// console.log('_doTriggerQuickSuggest() 호출')
		if (QuickSuggestionsOptions.isAllOff(this._editor.getOption(EditorOption.quickSuggestions))) {
			// 빠른 제안 설정이 모두 꺼진 상태
			return;
		}

		if (this._editor.getOption(EditorOption.suggest).snippetsPreventQuickSuggestions && SnippetController2.get(this._editor)?.isInSnippet()) {
			// 스니펫 모드에서는 빠른 제안 안하기
			return;
		}

		this.cancel();

		// quickSuggestionsDelay 옵션에서 지정한 시간이 지나면 빠른 제안 트리거
		this._triggerQuickSuggest.cancelAndSet(() => {
			if (this._triggerState !== undefined) {
				return;
			}
			if (!LineContext.shouldAutoTrigger(this._editor)) {
				return;
			}
			if (!this._editor.hasModel() || !this._editor.hasWidgetFocus()) {
				return;
			}

			const model = this._editor.getModel();
			const pos = this._editor.getPosition();
			// validate enabled now
			const config = this._editor.getOption(EditorOption.quickSuggestions);
			if (QuickSuggestionsOptions.isAllOff(config)) {
				return;
			}

			if (!QuickSuggestionsOptions.isAllOn(config)) {
				// Check the type of the token that triggered this
				model.tokenization.tokenizeIfCheap(pos.lineNumber);
				const lineTokens = model.tokenization.getLineTokens(pos.lineNumber);
				const tokenType = lineTokens.getStandardTokenType(lineTokens.findTokenIndexAtOffset(Math.max(pos.column - 1 - 1, 0)));
				if (QuickSuggestionsOptions.valueFor(config, tokenType) !== 'on') {
					return;
				}
			}

			if (!canShowQuickSuggest(this._editor, this._contextKeyService, this._configurationService)) {
				// 인라인 제안(inline suggestion)이 보여지는 경우에는 빠른 제안 트리거 안하기
				return;
			}

			if (!this._languageFeaturesService.completionProvider.has(model)) {
				return;
			}

			// we made it till here -> trigger now
			this.trigger({ auto: true });

		}, this._editor.getOption(EditorOption.quickSuggestionsDelay));
	}

	private _refilterCompletionItems(): void {
		assertType(this._editor.hasModel());
		assertType(this._triggerState !== undefined);

		const model = this._editor.getModel();
		const position = this._editor.getPosition();
		const ctx = new LineContext(model, position, { ...this._triggerState, refilter: true });
		this._onNewContext(ctx);
	}

	/** 제안 트리거하기 */
	trigger(options: SuggestTriggerOptions): void {
		// console.log('trigger({...}) 호출')
		if (!this._editor.hasModel()) {
			return;
		}

		const model = this._editor.getModel();
		const ctx = new LineContext(model, this._editor.getPosition(), options);

		// Cancel previous requests, change state & update UI
		this.cancel(options.retrigger);
		this._triggerState = options;
		this._onDidTrigger.fire({ auto: options.auto, shy: options.shy ?? false, position: this._editor.getPosition() });

		// Capture line context when request was sent
		this._context = ctx;

		// Build context for request
		let suggestCtx: CompletionContext = { triggerKind: options.triggerKind ?? CompletionTriggerKind.Invoke };
		if (options.triggerCharacter) {
			suggestCtx = {
				triggerKind: CompletionTriggerKind.TriggerCharacter,
				triggerCharacter: options.triggerCharacter
			};
		}

		this._requestToken = new CancellationTokenSource();

		// kind filter and snippet sort rules
		const snippetSuggestions = this._editor.getOption(EditorOption.snippetSuggestions);
		let snippetSortOrder = SnippetSortOrder.Inline;
		switch (snippetSuggestions) {
			case 'top':
				snippetSortOrder = SnippetSortOrder.Top;
				break;
			// 	↓ that's the default anyways...
			// case 'inline':
			// 	snippetSortOrder = SnippetSortOrder.Inline;
			// 	break;
			case 'bottom':
				snippetSortOrder = SnippetSortOrder.Bottom;
				break;
		}

		const { itemKind: itemKindFilter, showDeprecated } = SuggestModel._createSuggestFilter(this._editor);
		const completionOptions = new CompletionOptions(
			snippetSortOrder,
			options.completionOptions?.kindFilter ?? itemKindFilter,
			options.completionOptions?.providerFilter,
			options.completionOptions?.providerItemsToReuse,
			showDeprecated
		);
		const wordDistance = WordDistance.create(this._editorWorkerService, this._editor);

		// 여기서 문서 내에 있는 단어들을 분리해냄.
		// completions.items 배열에 문서 내 단어들이 저장
		const completions = provideSuggestionItems(
			this._languageFeaturesService.completionProvider,
			model,
			this._editor.getPosition(),
			completionOptions,
			suggestCtx,
			this._requestToken.token
		);

		Promise.all([completions, wordDistance]).then(async ([completions, wordDistance]) => {

			this._requestToken?.dispose();

			if (!this._editor.hasModel()) {
				return;
			}

			let clipboardText = options?.clipboardText;
			if (!clipboardText && completions.needsClipboard) {
				clipboardText = await this._clipboardService.readText();
			}

			if (this._triggerState === undefined) {
				return;
			}

			const model = this._editor.getModel();
			const ctx = new LineContext(model, this._editor.getPosition(), options);
			const fuzzySearchOptions = {
				...FuzzyScoreOptions.default,
				firstMatchCanBeWeak: !this._editor.getOption(EditorOption.suggest).matchOnWordStartOnly
			};
			this._completionModel = new CompletionModel(
				completions.items,
				this._context!.column,
				{
					leadingLineContent: ctx.leadingLineContent,
					characterCountDelta: ctx.column - this._context!.column
				},
				wordDistance,
				this._editor.getOption(EditorOption.suggest),
				this._editor.getOption(EditorOption.snippetSuggestions),
				fuzzySearchOptions,
				clipboardText
			);

			// store containers so that they can be disposed later
			this._completionDisposables.add(completions.disposable);

			// 여기서 추천 단어 목룍 만듦
			this._onNewContext(ctx);

			// finally report telemetry about durations
			this._reportDurationsTelemetry(completions.durations);

			// report invalid completions by source
			if (!this._envService.isBuilt || this._envService.isExtensionDevelopment) {
				for (const item of completions.items) {
					if (item.isInvalid) {
						this._logService.warn(`[suggest] did IGNORE invalid completion item from ${item.provider._debugDisplayName}`, item.completion);
					}
				}
			}

		}).catch(onUnexpectedError);
	}

	private _telemetryGate: number = 0;

	private _reportDurationsTelemetry(durations: CompletionDurations): void {

		if (this._telemetryGate++ % 230 !== 0) {
			return;
		}

		setTimeout(() => {
			type Durations = { data: string };
			type DurationsClassification = {
				owner: 'jrieken';
				comment: 'Completions performance numbers';
				data: { comment: 'Durations per source and overall'; classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth' };
			};
			this._telemetryService.publicLog2<Durations, DurationsClassification>('suggest.durations.json', { data: JSON.stringify(durations) });
			this._logService.debug('suggest.durations.json', durations);
		});
	}

	/**
	 * 제안 리스트에 보여줄 아이템 종류 세트 만들기 \
	 * (ex. 변수, 함수, 메서드, ...)
	*/
	private static _createSuggestFilter(editor: ICodeEditor): { itemKind: Set<CompletionItemKind>; showDeprecated: boolean } {
		// kind filter and snippet sort rules
		const result = new Set<CompletionItemKind>();

		// snippet setting
		const snippetSuggestions = editor.getOption(EditorOption.snippetSuggestions);
		if (snippetSuggestions === 'none') { result.add(CompletionItemKind.Snippet); }

		// type setting
		const suggestOptions = editor.getOption(EditorOption.suggest);
		if (!suggestOptions.showMethods) { result.add(CompletionItemKind.Method); }
		if (!suggestOptions.showFunctions) { result.add(CompletionItemKind.Function); }
		if (!suggestOptions.showConstructors) { result.add(CompletionItemKind.Constructor); }
		if (!suggestOptions.showFields) { result.add(CompletionItemKind.Field); }
		if (!suggestOptions.showVariables) { result.add(CompletionItemKind.Variable); }
		if (!suggestOptions.showClasses) { result.add(CompletionItemKind.Class); }
		if (!suggestOptions.showStructs) { result.add(CompletionItemKind.Struct); }
		if (!suggestOptions.showInterfaces) { result.add(CompletionItemKind.Interface); }
		if (!suggestOptions.showModules) { result.add(CompletionItemKind.Module); }
		if (!suggestOptions.showProperties) { result.add(CompletionItemKind.Property); }
		if (!suggestOptions.showEvents) { result.add(CompletionItemKind.Event); }
		if (!suggestOptions.showOperators) { result.add(CompletionItemKind.Operator); }
		if (!suggestOptions.showUnits) { result.add(CompletionItemKind.Unit); }
		if (!suggestOptions.showValues) { result.add(CompletionItemKind.Value); }
		if (!suggestOptions.showConstants) { result.add(CompletionItemKind.Constant); }
		if (!suggestOptions.showEnums) { result.add(CompletionItemKind.Enum); }
		if (!suggestOptions.showEnumMembers) { result.add(CompletionItemKind.EnumMember); }
		if (!suggestOptions.showKeywords) { result.add(CompletionItemKind.Keyword); }
		if (!suggestOptions.showWords) { result.add(CompletionItemKind.Text); }
		if (!suggestOptions.showColors) { result.add(CompletionItemKind.Color); }
		if (!suggestOptions.showFiles) { result.add(CompletionItemKind.File); }
		if (!suggestOptions.showReferences) { result.add(CompletionItemKind.Reference); }
		if (!suggestOptions.showColors) { result.add(CompletionItemKind.Customcolor); }
		if (!suggestOptions.showFolders) { result.add(CompletionItemKind.Folder); }
		if (!suggestOptions.showTypeParameters) { result.add(CompletionItemKind.TypeParameter); }
		if (!suggestOptions.showSnippets) { result.add(CompletionItemKind.Snippet); }
		if (!suggestOptions.showUsers) { result.add(CompletionItemKind.User); }
		if (!suggestOptions.showIssues) { result.add(CompletionItemKind.Issue); }

		return { itemKind: result, showDeprecated: suggestOptions.showDeprecated };
	}

	/** 현재 줄에 있는 내용이 변경된 경우  */
	private _onNewContext(ctx: LineContext): void {

		if (!this._context) {
			// happens when 24x7 IntelliSense is enabled and still in its delay
			return;
		}

		if (ctx.lineNumber !== this._context.lineNumber) {
			// e.g. happens when pressing Enter while IntelliSense is computed
			this.cancel();
			return;
		}

		if (getLeadingWhitespace(ctx.leadingLineContent) !== getLeadingWhitespace(this._context.leadingLineContent)) {
			// cancel IntelliSense when line start changes. happens when the current word gets outdented
			this.cancel();
			return;
		}

		if (ctx.column < this._context.column) {
			// 타이핑 -> 커서가 `왼쪽`으로 이동 -> 여전히 단어 위에 있으면 다시 트리거
			if (ctx.leadingWord.word) {
				this.trigger({ auto: this._context.triggerOptions.auto, retrigger: true });
			} else {
				this.cancel();
			}
			return;
		}

		if (!this._completionModel) {
			// happens when IntelliSense is not yet computed
			return;
		}

		if (ctx.leadingWord.word.length !== 0 && ctx.leadingWord.startColumn > this._context.leadingWord.startColumn) {
			// 인텔리센스가 보이는 중에 새로운 단어를 시작했음 -> 다시 트리거하기 (현재 가지고 있는 아이템s 재사용)
			const shouldAutoTrigger = LineContext.shouldAutoTrigger(this._editor);
			if (shouldAutoTrigger && this._context) {
				// shouldAutoTrigger forces tokenization, which can cause pending cursor change events to be emitted,
				// which can cause suggestions to be cancelled, which causes `this._context` to be undefined
				const map = this._completionModel.getItemsByProvider();
				this.trigger({
					auto: this._context.triggerOptions.auto,
					retrigger: true,
					clipboardText: this._completionModel.clipboardText,
					completionOptions: { providerItemsToReuse: map }
				});
			}
			return;
		}

		if (ctx.column > this._context.column
			&& this._completionModel.getIncompleteProvider().size > 0
			&& ctx.leadingWord.word.length !== 0
		) {
			// 타이핑 -> 커서가 `오른쪽`으로 이동 & incomple model & 여전히 단어 위에 있음 -> 다시 트리거

			const providerItemsToReuse = new Map<CompletionItemProvider, CompletionItem[]>();
			const providerFilter = new Set<CompletionItemProvider>();
			for (const [provider, items] of this._completionModel.getItemsByProvider()) {
				if (items.length > 0 && items[0].container.incomplete) {
					providerFilter.add(provider);
				} else {
					providerItemsToReuse.set(provider, items);
				}
			}

			this.trigger({
				auto: this._context.triggerOptions.auto,
				triggerKind: CompletionTriggerKind.TriggerForIncompleteCompletions,
				retrigger: true,
				clipboardText: this._completionModel.clipboardText,
				completionOptions: { providerFilter, providerItemsToReuse }
			});

		} else {
			// 타이핑 -> 커서가 `오른쪽`으로 이동 -> update UI
			const oldLineContext = this._completionModel.lineContext;
			let isFrozen = false;

			this._completionModel.lineContext = {
				leadingLineContent: ctx.leadingLineContent,
				characterCountDelta: ctx.column - this._context.column
			};

			// console.log('_onNewContext - 비슷한 단어 리스트 만들기')
			// ** this._completionModel.items 호출하면 제안 리스트 만드는 곳으로 이동 **
			if (this._completionModel.items.length === 0) {

				const shouldAutoTrigger = LineContext.shouldAutoTrigger(this._editor);
				if (!this._context) {
					// shouldAutoTrigger forces tokenization, which can cause pending cursor change events to be emitted,
					// which can cause suggestions to be cancelled, which causes `this._context` to be undefined
					this.cancel();
					return;
				}

				if (shouldAutoTrigger && this._context.leadingWord.endColumn < ctx.leadingWord.startColumn) {
					// retrigger when heading into a new word
					this.trigger({
						auto: this._context.triggerOptions.auto,
						retrigger: true
					});
					return;
				}

				if (!this._context.triggerOptions.auto) {
					// freeze when IntelliSense was manually requested
					this._completionModel.lineContext = oldLineContext;
					isFrozen = (this._completionModel.items.length > 0);

					if (isFrozen && ctx.leadingWord.word.length === 0) {
						// there were results before but now there aren't
						// and also we are not on a word anymore -> cancel
						this.cancel();
						return;
					}

				} else {
					// nothing left
					this.cancel();
					return;
				}
			}

			this._onDidSuggest.fire({
				completionModel: this._completionModel,
				triggerOptions: ctx.triggerOptions,
				isFrozen,
			});
		}
	}
}
