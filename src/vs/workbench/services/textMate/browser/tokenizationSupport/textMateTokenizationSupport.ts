/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { StopWatch } from 'vs/base/common/stopwatch';
import { LanguageId, TokenMetadata } from 'vs/editor/common/encodedTokenAttributes';
import { EncodedTokenizationResult, IBackgroundTokenizationStore, IBackgroundTokenizer, IState, ITokenizationSupport, TokenizationResult } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import type { IGrammar, StateStack } from 'vscode-textmate';

export class TextMateTokenizationSupport extends Disposable implements ITokenizationSupport {
	private readonly _seenLanguages: boolean[] = [];
	private readonly _onDidEncounterLanguage: Emitter<LanguageId> = this._register(new Emitter<LanguageId>());
	public readonly onDidEncounterLanguage: Event<LanguageId> = this._onDidEncounterLanguage.event;

	constructor(
		private readonly _grammar: IGrammar,
		private readonly _initialState: StateStack,
		private readonly _containsEmbeddedLanguages: boolean,
		private readonly _createBackgroundTokenizer: ((textModel: ITextModel, tokenStore: IBackgroundTokenizationStore) => IBackgroundTokenizer | undefined) | undefined,
		private readonly _backgroundTokenizerShouldOnlyVerifyTokens: () => boolean,
		private readonly _reportTokenizationTime: (timeMs: number, lineLength: number, isRandomSample: boolean) => void,
		private readonly _reportSlowTokenization: boolean,
	) {
		super();
	}

	public get backgroundTokenizerShouldOnlyVerifyTokens(): boolean | undefined {
		return this._backgroundTokenizerShouldOnlyVerifyTokens();
	}

	public getInitialState(): IState {
		return this._initialState;
	}

	public tokenize(line: string, hasEOL: boolean, state: IState): TokenizationResult {
		throw new Error('Not supported!');
	}

	public createBackgroundTokenizer(textModel: ITextModel, store: IBackgroundTokenizationStore): IBackgroundTokenizer | undefined {
		if (this._createBackgroundTokenizer) {
			return this._createBackgroundTokenizer(textModel, store);
		}
		return undefined;
	}
	/**
	 * [첨자] memo: \
	 * 모든 토큰에 italic 스타일 적용되고, 위첨자 적용되는 원인은 \
	 * `this._grammar.tokenizeLine2(line, state, 500);`에 있는거 같음 \
	 * 이 메서드는 src 폴더 범위 밖이라서 수정 못하는거 같음
	 *
	 * 아마도 토크나이저가 내가 수정하기 전 토큰 포맷을 기초로 토크나이징하기 \
	 * 때문인듯 함. (editor/common/encodedTokenAttributes.ts)
	*/
	public tokenizeEncoded(line: string, hasEOL: boolean, state: StateStack): EncodedTokenizationResult {
		const isRandomSample = Math.random() * 10_000 < 1;
		const shouldMeasure = this._reportSlowTokenization || isRandomSample;
		const sw = shouldMeasure ? new StopWatch(true) : undefined;
		const textMateResult = this._grammar.tokenizeLine2(line, state, 500);
		//#region --- 임시조치: 반환된 메타데이터 포맷을 수정 --------------------------

		// bbbb bbbb ffff ffff fFFF FBTT LLLL LLLL
		//            ^^^ ^^^^ ^!!! !*
		// bbbb bbbb ffff ffff FFFF FFTT BLLL LLLL
		//           ^^^^ ^^^^   !! !!   *
		for (let i = 0, len = textMateResult.tokens.length / 2; i < len; i++) {
			const metadataBefore = textMateResult.tokens[2 * i + 1];
			const metadataAfter =
				((metadataBefore & 0b0000_0000_0111_1111_1000_0000_0000_0000) << 1) |
				((metadataBefore & 0b0000_0000_0000_0000_0111_1000_0000_0000) >> 1) |
				((metadataBefore & 0b0000_0000_0000_0000_0000_0100_0000_0000) >> 3) |
				((metadataBefore & 0b1111_1111_0000_0000_0000_0011_0111_1111)) // 안바뀌는 포맷들
				;
			textMateResult.tokens[2 * i + 1] = metadataAfter;
			// console.log('메타데이터 전: ' + metadataBefore.toString(2));
			// console.log('메타데이터 후: ' + metadataAfter.toString(2));
		}
		//#endregion

		if (shouldMeasure) {
			const timeMS = sw!.elapsed();
			if (isRandomSample || timeMS > 32) {
				this._reportTokenizationTime!(timeMS, line.length, isRandomSample);
			}
		}

		if (textMateResult.stoppedEarly) {
			console.warn(`Time limit reached when tokenizing line: ${line.substring(0, 100)}`);
			// return the state at the beginning of the line
			return new EncodedTokenizationResult(textMateResult.tokens, state);
		}

		if (this._containsEmbeddedLanguages) {
			const seenLanguages = this._seenLanguages;
			const tokens = textMateResult.tokens;

			// Must check if any of the embedded languages was hit
			for (let i = 0, len = (tokens.length >>> 1); i < len; i++) {
				const metadata = tokens[(i << 1) + 1];
				const languageId = TokenMetadata.getLanguageId(metadata);

				if (!seenLanguages[languageId]) {
					seenLanguages[languageId] = true;
					this._onDidEncounterLanguage.fire(languageId);
				}
			}
		}

		let endState: StateStack;
		// try to save an object if possible
		if (state.equals(textMateResult.ruleStack)) {
			endState = state;
		} else {
			endState = textMateResult.ruleStack;
		}

		return new EncodedTokenizationResult(textMateResult.tokens, endState);
	}
}
