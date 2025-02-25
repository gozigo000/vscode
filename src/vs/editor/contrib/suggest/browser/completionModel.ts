/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요]
 * export interface ICompletionStats
 * export class LineContext
 * export class CompletionModel
 *--------------------------------------------------------------------------------------------*/

import { quickSelect } from 'vs/base/common/arrays';
import { CharCode } from 'vs/base/common/charCode';
import { anyScore, /* fuzzyScore, */ banacoScore, FuzzyScore, /* fuzzyScoreGracefulAggressive, */ FuzzyScoreOptions, FuzzyScorer } from 'vs/base/common/filters';
import { compareIgnoreCase } from 'vs/base/common/strings';
import { InternalSuggestOptions } from 'vs/editor/common/config/editorOptions';
import { CompletionItemKind, CompletionItemProvider } from 'vs/editor/common/languages';
import { WordDistance } from 'vs/editor/contrib/suggest/browser/wordDistance';
import { CompletionItem } from './suggest';

type StrictCompletionItem = Required<CompletionItem>;

export interface ICompletionStats {
	pLabelLen: number;
}

export class LineContext {
	constructor(
		readonly leadingLineContent: string,
		readonly characterCountDelta: number,
	) { }
}

/** `Nothing` = 0, `All` = 1, `Incr` = 2 */
const enum Refilter {
	/**  */
	Nothing = 0,
	/** 문서 내에 있는 단어들 전부 점수 계산하는 경우 */
	All = 1,
	/** 제안 리스트에 있는 단어들만 대상으로 점수 계산하는 경우 */
	Incr = 2
}

/**
 * Sorted, filtered completion view model
 */
export class CompletionModel {

	private readonly _items: CompletionItem[];
	private readonly _column: number;
	private readonly _wordDistance: WordDistance;
	private readonly _options: InternalSuggestOptions;
	private readonly _snippetCompareFn = CompletionModel._compareCompletionItems;
	private readonly _fuzzyScoreOptions: FuzzyScoreOptions;

	private _lineContext: LineContext;
	private _refilterKind: Refilter;
	private _filteredItems?: StrictCompletionItem[];

	private _itemsByProvider?: Map<CompletionItemProvider, CompletionItem[]>;
	private _stats?: ICompletionStats;

	constructor(
		items: CompletionItem[],
		column: number,
		lineContext: LineContext,
		wordDistance: WordDistance,
		options: InternalSuggestOptions,
		snippetSuggestions: 'top' | 'bottom' | 'inline' | 'none',
		fuzzyScoreOptions: FuzzyScoreOptions | undefined = FuzzyScoreOptions.default,
		readonly clipboardText: string | undefined = undefined
	) {
		this._items = items;
		this._column = column;
		this._wordDistance = wordDistance;
		this._options = options;
		this._refilterKind = Refilter.All;
		this._lineContext = lineContext;
		this._fuzzyScoreOptions = fuzzyScoreOptions;

		if (snippetSuggestions === 'top') {
			this._snippetCompareFn = CompletionModel._compareCompletionItemsSnippetsUp;
		} else if (snippetSuggestions === 'bottom') {
			this._snippetCompareFn = CompletionModel._compareCompletionItemsSnippetsDown;
		}
	}

	get lineContext(): LineContext {
		return this._lineContext;
	}

	set lineContext(value: LineContext) {
		if (this._lineContext.leadingLineContent !== value.leadingLineContent
			|| this._lineContext.characterCountDelta !== value.characterCountDelta
		) {
			this._refilterKind = (this._lineContext.characterCountDelta < value.characterCountDelta && this._filteredItems) ? Refilter.Incr : Refilter.All;
			this._lineContext = value;
		}
	}

	get items(): CompletionItem[] {
		this._ensureCachedState();
		return this._filteredItems!;
	}

	getItemsByProvider(): ReadonlyMap<CompletionItemProvider, CompletionItem[]> {
		this._ensureCachedState();
		return this._itemsByProvider!;
	}

	getIncompleteProvider(): Set<CompletionItemProvider> {
		this._ensureCachedState();
		const result = new Set<CompletionItemProvider>();
		for (const [provider, items] of this.getItemsByProvider()) {
			if (items.length > 0 && items[0].container.incomplete) {
				result.add(provider);
			}
		}
		return result;
	}

	get stats(): ICompletionStats {
		this._ensureCachedState();
		return this._stats!;
	}

	private _ensureCachedState(): void {
		if (this._refilterKind !== Refilter.Nothing) {
			this._createCachedState();
		}
	}

	/** 제안 리스트 만드는 곳 */
	private _createCachedState(): void {

		this._itemsByProvider = new Map();

		const labelLengths: number[] = [];

		const { leadingLineContent, characterCountDelta } = this._lineContext;
		let word = '';
		let wordLow = '';

		// incrementally filter less
		const source = (this._refilterKind === Refilter.All) ? this._items : this._filteredItems!; // 매칭 후보 아이템들 담는 곳
		const target: StrictCompletionItem[] = []; // 매칭 성공한 아이템들 담는 곳

		// 퍼지 점수 계산할 함수 고르기
		// 점수계산(또는 필터링)해야 하는 아이템 갯수랑 사용자 옵션 설정에 기초해서 고름
		// const scoreFn: FuzzyScorer = (source.length > 2000 || !this._options.filterGraceful) ? fuzzyScore : fuzzyScoreGracefulAggressive;
		// const scoreFn: FuzzyScorer = (source.length > 2000 || !this._options.filterGraceful) ? fuzzyScore : banacoScore;
		const scoreFn: FuzzyScorer = (source.length > 2000 || !this._options.filterGraceful) ? banacoScore : banacoScore;

		for (let i = 0; i < source.length; i++) {

			const item = source[i];

			if (item.isInvalid) {
				continue; // SKIP invalid items
			}

			// keep all items by their provider
			const arr = this._itemsByProvider.get(item.provider);
			if (arr) {
				arr.push(item);
			} else {
				this._itemsByProvider.set(item.provider, [item]);
			}

			// 'word' is that remainder of the current line that we
			// filter and score against. In theory each suggestion uses a
			// different word, but in practice not - that's why we cache
			const overwriteBefore = item.position.column - item.editStart.column;
			const wordLen = overwriteBefore + characterCountDelta - (item.position.column - this._column);
			if (word.length !== wordLen) {
				word = (wordLen === 0) ? '' : leadingLineContent.slice(-wordLen);
				wordLow = word.toLowerCase();
			}

			// 아이템의 점수 계산시 비교대상이 되는 단어 기억해놓기
			item.word = word;

			if (wordLen === 0) {
				// when there is nothing to score against, don't
				// event try to do. Use a const rank and rely on
				// the fallback-sort using the initial sort order.
				// use a score of `-100` because that is out of the
				// bound of values `fuzzyScore` will return
				item.score = FuzzyScore.Default;

			} else {
				// skip word characters that are whitespace until
				// we have hit the replace range (overwriteBefore)
				let wordPos = 0;
				while (wordPos < overwriteBefore) {
					const ch = word.charCodeAt(wordPos);
					if (ch === CharCode.Space || ch === CharCode.Tab) {
						wordPos += 1;
					} else {
						break;
					}
				}

				if (wordPos >= wordLen) {
					// the wordPos at which scoring starts is the whole word
					// and therefore the same rules as not having a word apply
					item.score = FuzzyScore.Default;

				} else if (typeof item.completion.filterText === 'string') {
					// when there is a `filterText` it must match the `word`.
					// if it matches we check with the label to compute highlights
					// and if that doesn't yield a result we have no highlights,
					// despite having the match
					const match = scoreFn(word, wordLow, wordPos, item.completion.filterText, item.filterTextLow!, 0, this._fuzzyScoreOptions);
					if (!match) {
						continue; // NO match
					}
					if (compareIgnoreCase(item.completion.filterText, item.textLabel) === 0) {
						// filterText and label are actually the same -> use good highlights
						item.score = match;
					} else {
						// re-run the scorer on the label in the hope of a result BUT use the rank
						// of the filterText-match
						item.score = anyScore(word, wordLow, wordPos, item.textLabel, item.labelLow, 0);
						item.score[0] = match[0]; // use score from filterText
					}

				} else {
					// 기본 케이스 - scoreFn으로 `word`와 `label` 비교해서 점수 계산
					const match = scoreFn(word, wordLow, wordPos, item.textLabel, item.labelLow, 0, this._fuzzyScoreOptions);
					if (!match) {
						continue; // 매칭 실패!
					}
					item.score = match; // 매칭 성공! - 퍼지 점수 기록
				}
			}

			item.idx = i; // 매칭 성공한 아이템의 source[i] 인덱스 기록
			item.distance = this._wordDistance.distance(item.position, item.completion);
			target.push(item as StrictCompletionItem); // 매칭 성공한 아이템 담기

			// update stats
			labelLengths.push(item.textLabel.length); // 매칭 성공한 아이템의 문자열 길이 담기
		}

		this._filteredItems = target.sort(this._snippetCompareFn); // 매칭 성공한 아이템들 정렬하기
		this._refilterKind = Refilter.Nothing;
		this._stats = {
			pLabelLen: labelLengths.length ?
				quickSelect(labelLengths.length - .85, labelLengths, (a, b) => a - b)
				: 0
		};
	}
	/** 매칭 성공한 아이템들 정렬 기준 함수 */
	private static _compareCompletionItems(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.score[0] > b.score[0]) {
			return -1;
		} else if (a.score[0] < b.score[0]) {
			return 1;
		} else if (a.distance < b.distance) {
			return -1;
		} else if (a.distance > b.distance) {
			return 1;
		} else if (a.idx < b.idx) {
			return -1;
		} else if (a.idx > b.idx) {
			return 1;
		} else {
			return 0;
		}
	}

	private static _compareCompletionItemsSnippetsDown(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.completion.kind !== b.completion.kind) {
			if (a.completion.kind === CompletionItemKind.Snippet) {
				return 1;
			} else if (b.completion.kind === CompletionItemKind.Snippet) {
				return -1;
			}
		}
		return CompletionModel._compareCompletionItems(a, b);
	}

	private static _compareCompletionItemsSnippetsUp(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.completion.kind !== b.completion.kind) {
			if (a.completion.kind === CompletionItemKind.Snippet) {
				return -1;
			} else if (b.completion.kind === CompletionItemKind.Snippet) {
				return 1;
			}
		}
		return CompletionModel._compareCompletionItems(a, b);
	}
}
