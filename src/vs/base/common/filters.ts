/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * 문자열 매칭 관련 함수들
 *
 * [개요] export
 * export interface IFilter
 * export interface IMatch
 * export function or
 * export const matchesStrictPrefix: IFilter = _matchesPrefix.bind(undefined, false);
 * export const matchesPrefix: IFilter = _matchesPrefix.bind(undefined, true);
 * export function matchesContiguousSubString
 * export function matchesSubString
 * export function isUpper
 * export function matchesCamelCase
 * export function matchesWords
 * -------- Fuzzy ----------
 * export function matchesFuzzy
 * export function matchesFuzzy2
 * export function anyScore
 * export function createMatches
 * export function isPatternInWord
 * export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];
 * export namespace FuzzyScore
 * export abstract class FuzzyScoreOptions
 * export interface FuzzyScorer
[*]export function fuzzyScore
 * export function fuzzyScoreGracefulAggressive
 * export function fuzzyScoreGraceful
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { LRUCache } from 'vs/base/common/map';
import * as strings from 'vs/base/common/strings';

export interface IFilter {
	// `word`와 일치하는 부분이 없으면 null 반환
	(word: string, wordToMatchAgainst: string): IMatch[] | null;
}

/**
 * 일치하는 위치
 * - `start`
 * - `end`
 */
export interface IMatch {
	start: number;
	end: number;
}

// Combined filters

/**
 * 여러 필터함수들을 'or'로 결합한 필터함수를 반환 \
 * 일치가 있는 **첫 번째** 필터가 반환된 필터함수의 반환 값을 정함
 */
export function or(...filter: IFilter[]): IFilter {
	return function (word: string, wordToMatchAgainst: string): IMatch[] | null {
		for (let i = 0, len = filter.length; i < len; i++) {
			const match = filter[i](word, wordToMatchAgainst);
			if (match) {
				return match;
			}
		}
		return null;
	};
}

// 접두사 일치 검사

/** 접두사 일치 검사 (대소문자 구분) */
export const matchesStrictPrefix: IFilter = _matchesPrefix.bind(undefined, false);
/** 접두사 일치 검사 (대소문자 구분 안함) */
export const matchesPrefix: IFilter = _matchesPrefix.bind(undefined, true);

function _matchesPrefix(ignoreCase: boolean, word: string, wordToMatchAgainst: string): IMatch[] | null {
	if (!wordToMatchAgainst || wordToMatchAgainst.length < word.length) {
		return null;
	}

	let matches: boolean;
	if (ignoreCase) {
		matches = strings.startsWithIgnoreCase(wordToMatchAgainst, word);
	} else {
		matches = wordToMatchAgainst.indexOf(word) === 0;
	}

	if (!matches) {
		return null;
	}

	return word.length > 0 ? [{ start: 0, end: word.length }] : [];
}

// Contiguous Substring

/**
 * `wordToMatchAgainst` 문자열 내에 `word`가 있는지 검사
 * - 대소문자 구분 안함
*/
export function matchesContiguousSubString(word: string, wordToMatchAgainst: string): IMatch[] | null {
	const index = wordToMatchAgainst.toLowerCase().indexOf(word.toLowerCase());
	if (index === -1) {
		return null;
	}

	return [{ start: index, end: index + word.length }];
}

// Substring

/**
 * `wordToMatchAgainst` 문자열 내에 `word`와 일치하는 부분수열이 있는지 검사
 * - 대소문자 구분 안함
 * @example
 * word = 'ABCD'
 * wordToMatchAgainst = 'ab d abc Def'
 *                       ^^     ^ ^
 * 반환: [(0,2) (7,8) (9,10)]
 */
export function matchesSubString(word: string, wordToMatchAgainst: string): IMatch[] | null {
	return _matchesSubString(word.toLowerCase(), wordToMatchAgainst.toLowerCase(), 0, 0);
}

function _matchesSubString(word: string, wordToMatchAgainst: string, i: number, j: number): IMatch[] | null {
	if (i === word.length) {
		return [];
	} else if (j === wordToMatchAgainst.length) {
		return null;
	} else {
		if (word[i] === wordToMatchAgainst[j]) {
			let result: IMatch[] | null = null;
			if (result = _matchesSubString(word, wordToMatchAgainst, i + 1, j + 1)) {
				return join({ start: j, end: j + 1 }, result);
			}
			return null;
		}

		return _matchesSubString(word, wordToMatchAgainst, i, j + 1);
	}
}

// CamelCase

function isLower(code: number): boolean {
	return CharCode.a <= code && code <= CharCode.z;
}

export function isUpper(code: number): boolean {
	return CharCode.A <= code && code <= CharCode.Z;
}

function isNumber(code: number): boolean {
	return CharCode.Digit0 <= code && code <= CharCode.Digit9;
}
/** `\t`,`\r`,`\n`,` ` 체크 */
function isWhitespace(code: number): boolean {
	return (
		code === CharCode.Space
		|| code === CharCode.Tab
		|| code === CharCode.LineFeed
		|| code === CharCode.CarriageReturn
	);
}

/**
 * 단어 구분 기호s
 * - ```()[]{}<>-/:;.,?!`'"```
 * - +@
 */
const wordSeparators = new Set<number>();
// These are chosen as natural word separators based on writen text.
// It is a subset of the word separators used by the monaco editor.
'()[]{}<>`\'"-/;:,.?!'
	.split('')
	.forEach(s => wordSeparators.add(s.charCodeAt(0)));

/**
 * 다음 중 하나에 해당하는지 체크
 * - 공백 문자 - `\t`,`\r`,`\n`,` `,
 * - 단어 구분 기호 - ```()[]{}<>-/:;.,?!`'"``` +@
 */
function isWordSeparator(code: number): boolean {
	return isWhitespace(code) || wordSeparators.has(code);
}
/**
 * - `codeA`와 `codeB`가 같은 문자이거나,
 * - 둘 다 단어 구분 기호에 속하는지 체크
 */
function charactersMatch(codeA: number, codeB: number): boolean {
	return (codeA === codeB) || (isWordSeparator(codeA) && isWordSeparator(codeB));
}
/**
 * `알파벳` 또는 `숫자`인지 체크
 */
function isAlphanumeric(code: number): boolean {
	return isLower(code) || isUpper(code) || isNumber(code);
}

/**
 * `head`를 `tail` 배열 앞에 삽입
 * - 만약 `head`의 `end`와 `tail`의 첫 번째 원소 `start`가 같으면 \
 * `head`와 `tail`의 첫 번째 원소의 범위를 하나로 합침
 */
function join(head: IMatch, tail: IMatch[]): IMatch[] {
	if (tail.length === 0) {
		tail = [head];
	} else if (head.end === tail[0].start) {
		tail[0].start = head.start;
	} else {
		tail.unshift(head);
	}
	return tail;
}

/**
 * `camelCaseWord`에서 다음 중 하나에 해당하는 문자의 위치 반환
 * 1. 대문자
 * 2. 숫자
 * 3. 이전 문자가 알파벳, 숫자가 아닌 경우
 */
function nextAnchor(camelCaseWord: string, start: number): number {
	for (let i = start; i < camelCaseWord.length; i++) {
		const c = camelCaseWord.charCodeAt(i);
		if (isUpper(c) || isNumber(c) || (i > 0 && !isAlphanumeric(camelCaseWord.charCodeAt(i - 1)))) {
			return i;
		}
	}
	return camelCaseWord.length;
}

/** */
function _matchesCamelCase(word: string, camelCaseWord: string, i: number, j: number): IMatch[] | null {
	if (i === word.length) {
		return [];
	} else if (j === camelCaseWord.length) {
		return null;
	} else if (word[i] !== camelCaseWord[j].toLowerCase()) {
		return null;
	} else {
		let result: IMatch[] | null = null;
		let nextUpperIndex = j + 1;
		result = _matchesCamelCase(word, camelCaseWord, i + 1, j + 1);
		while (!result && (nextUpperIndex = nextAnchor(camelCaseWord, nextUpperIndex)) < camelCaseWord.length) {
			result = _matchesCamelCase(word, camelCaseWord, i + 1, nextUpperIndex);
			nextUpperIndex++;
		}
		return (result === null) ? null : join({ start: j, end: j + 1 }, result);
	}
}

interface ICamelCaseAnalysis {
	upperPercent: number;
	lowerPercent: number;
	alphaPercent: number;
	numericPercent: number;
}

// Heuristic to avoid computing camel case matcher for words that don't
// look like camelCaseWords.
function analyzeCamelCaseWord(word: string): ICamelCaseAnalysis {
	let upper = 0, lower = 0, alpha = 0, numeric = 0, code = 0;

	for (let i = 0; i < word.length; i++) {
		code = word.charCodeAt(i);

		if (isUpper(code)) { upper++; }
		if (isLower(code)) { lower++; }
		if (isAlphanumeric(code)) { alpha++; }
		if (isNumber(code)) { numeric++; }
	}

	const upperPercent = upper / word.length;
	const lowerPercent = lower / word.length;
	const alphaPercent = alpha / word.length;
	const numericPercent = numeric / word.length;

	return { upperPercent, lowerPercent, alphaPercent, numericPercent };
}

function isUpperCaseWord(analysis: ICamelCaseAnalysis): boolean {
	const { upperPercent, lowerPercent } = analysis;
	return lowerPercent === 0 && upperPercent > 0.6;
}

function isCamelCaseWord(analysis: ICamelCaseAnalysis): boolean {
	const { upperPercent, lowerPercent, alphaPercent, numericPercent } = analysis;
	return lowerPercent > 0.2 && upperPercent < 0.8 && alphaPercent > 0.6 && numericPercent < 0.2;
}

// Heuristic to avoid computing camel case matcher for words that don't
// look like camel case patterns.
function isCamelCasePattern(word: string): boolean {
	let upper = 0, lower = 0, code = 0, whitespace = 0;

	for (let i = 0; i < word.length; i++) {
		code = word.charCodeAt(i);

		if (isUpper(code)) { upper++; }
		if (isLower(code)) { lower++; }
		if (isWhitespace(code)) { whitespace++; }
	}

	if ((upper === 0 || lower === 0) && whitespace === 0) {
		return word.length <= 30;
	} else {
		return upper <= 5;
	}
}

export function matchesCamelCase(word: string, camelCaseWord: string): IMatch[] | null {
	if (!camelCaseWord) {
		return null;
	}

	camelCaseWord = camelCaseWord.trim();

	if (camelCaseWord.length === 0) {
		return null;
	}

	if (!isCamelCasePattern(word)) {
		return null;
	}

	if (camelCaseWord.length > 60) {
		return null;
	}

	const analysis = analyzeCamelCaseWord(camelCaseWord);

	if (!isCamelCaseWord(analysis)) {
		if (!isUpperCaseWord(analysis)) {
			return null;
		}

		camelCaseWord = camelCaseWord.toLowerCase();
	}

	let result: IMatch[] | null = null;
	let i = 0;

	word = word.toLowerCase();
	while (i < camelCaseWord.length && (result = _matchesCamelCase(word, camelCaseWord, 0, i)) === null) {
		i = nextAnchor(camelCaseWord, i + 1);
	}

	return result;
}

/**
 * Matches beginning of words supporting non-ASCII languages
 * - `contiguous`가 `true`이면 matches word with beginnings of the words in the `target`. (예: "pul" will match "Git: Pull")
 * - `contiguous`가 `false`이면 also matches sub string of the word with beginnings of the words in the `target`. (예: "gp" or "g p" will match "Git: Pull")
 *
 * Useful in cases where the target is words (예: command labels)
*/
export function matchesWords(word: string, target: string, contiguous: boolean = false): IMatch[] | null {
	if (!target || target.length === 0) {
		return null;
	}

	let result: IMatch[] | null = null;
	let i = 0;

	word = word.toLowerCase();
	target = target.toLowerCase();
	while (i < target.length && (result = _matchesWords(word, target, 0, i, contiguous)) === null) {
		i = nextWord(target, i + 1);
	}

	return result;
}

function _matchesWords(word: string, target: string, i: number, j: number, contiguous: boolean): IMatch[] | null {
	if (i === word.length) {
		return [];
	} else if (j === target.length) {
		return null;
	} else if (!charactersMatch(word.charCodeAt(i), target.charCodeAt(j))) {
		return null;
	} else {
		let result: IMatch[] | null = null;
		let nextWordIndex = j + 1;
		result = _matchesWords(word, target, i + 1, j + 1, contiguous);
		if (!contiguous) {
			while (!result && (nextWordIndex = nextWord(target, nextWordIndex)) < target.length) {
				result = _matchesWords(word, target, i + 1, nextWordIndex, contiguous);
				nextWordIndex++;
			}
		}

		if (!result) {
			return null;
		}

		// If the characters don't exactly match, then they must be word separators (see `charactersMatch(...)`).
		// We don't want to include this in the matches but we don't want to throw the target out all together so we return `result`.
		if (word.charCodeAt(i) !== target.charCodeAt(j)) {
			return result;
		}

		return join({ start: j, end: j + 1 }, result);
	}
}

/** 다음 단어 위치 반환 */
function nextWord(word: string, start: number): number {
	for (let i = start; i < word.length; i++) {
		if (isWordSeparator(word.charCodeAt(i)) ||
			(i > 0 && isWordSeparator(word.charCodeAt(i - 1)))) {
			return i;
		}
	}
	return word.length;
}

// Fuzzy

const fuzzyContiguousFilter = or(matchesPrefix, matchesCamelCase, matchesContiguousSubString);
const fuzzySeparateFilter = or(matchesPrefix, matchesCamelCase, matchesSubString);
const fuzzyRegExpCache = new LRUCache<string, RegExp>(10000); // bounded to 10000 elements

/**
 * `wordToMatchAgainst` 문자열 내에 `word`가 있는 검사
 * - `enableSeparateSubstringMatching` - 띄엄띄엄 문자열 매칭 검사 여부
 */
export function matchesFuzzy(word: string, wordToMatchAgainst: string, enableSeparateSubstringMatching = false): IMatch[] | null {
	if (typeof word !== 'string' || typeof wordToMatchAgainst !== 'string') {
		return null; // return early for invalid input
	}

	// Form RegExp for wildcard matches
	let regexp = fuzzyRegExpCache.get(word);
	if (!regexp) {
		regexp = new RegExp(strings.convertSimple2RegExpPattern(word), 'i');
		fuzzyRegExpCache.set(word, regexp);
	}

	// RegExp Filter
	const match = regexp.exec(wordToMatchAgainst);
	if (match) {
		return [{ start: match.index, end: match.index + match[0].length }];
	}

	// Default Filter
	return enableSeparateSubstringMatching ? fuzzySeparateFilter(word, wordToMatchAgainst) : fuzzyContiguousFilter(word, wordToMatchAgainst);
}

/**
 * `word` 문자열 내에 `pattern`이 있는 검사
 * - Match pattern against word in a fuzzy way. \
 * **As in IntelliSense** and **faster** and **more powerful** than `matchesFuzzy()`
 */
export function matchesFuzzy2(pattern: string, word: string): IMatch[] | null {
	const score = fuzzyScore(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0, { firstMatchCanBeWeak: true, boostFullMatch: true });
	return score ? createMatches(score) : null;
}

export function anyScore(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number): FuzzyScore {
	const max = Math.min(13, pattern.length);
	for (; patternPos < max; patternPos++) {
		const result = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, { firstMatchCanBeWeak: true, boostFullMatch: true });
		if (result) {
			return result;
		}
	}
	return [0, wordPos];
}

//#region --- fuzzyScore ---

/** `FuzzyScore`를 `IMatch[]`로 변환해주기 */
export function createMatches(score: undefined | FuzzyScore): IMatch[] {
	if (typeof score === 'undefined') {
		return [];
	}
	const res: IMatch[] = [];
	const wordPos = score[1];
	for (let i = score.length - 1; i > 1; i--) {
		const pos = score[i] + wordPos;
		const last = res[res.length - 1];
		if (last && last.end === pos) {
			last.end = pos + 1;
		} else {
			res.push({ start: pos, end: pos + 1 });
		}
	}
	return res;
}

const _maxLen = 128;

function initTable() {
	const table: number[][] = [];
	const row: number[] = [];
	for (let i = 0; i <= _maxLen; i++) {
		row[i] = 0;
	}
	for (let i = 0; i <= _maxLen; i++) {
		table.push(row.slice(0));
	}
	return table;
}

function initArr(maxLen: number) {
	const row: number[] = [];
	for (let i = 0; i <= maxLen; i++) {
		row[i] = 0;
	}
	return row;
}

const _minWordMatchPos = initArr(2 * _maxLen); // min word position for a certain pattern position
const _maxWordMatchPos = initArr(2 * _maxLen); // max word position for a certain pattern position
const _diag = initTable(); // 연속적인 대각선 매칭 길이
const _table = initTable();
const _arrows = <Arrow[][]>initTable();
const _debug = false;

/** 디버깅 - 퍼지점수 테이블 그리기 */
function printTable(table: number[][], pattern: string, patternLen: number, word: string, wordLen: number): string {
	function pad(s: string, n: number, pad = ' ') {
		while (s.length < n) {
			s = pad + s;
		}
		return s;
	}
	let ret = ` |   |${word.split('').map(c => pad(c, 3)).join('|')}\n`;

	for (let i = 0; i <= patternLen; i++) {
		if (i === 0) {
			ret += ' |';
		} else {
			ret += `${pattern[i - 1]}|`;
		}
		ret += table[i].slice(0, wordLen + 1).map(n => pad(n.toString(), 3)).join('|') + '\n';
	}
	return ret;
}
/** 디버깅 - 퍼지점수 테이블 출력 */
function printTables(pattern: string, patternStart: number, word: string, wordStart: number): void {
	pattern = pattern.substr(patternStart);
	word = word.substr(wordStart);
	console.log('_table:\n');
	console.log(printTable(_table, pattern, pattern.length, word, word.length));
	console.log('_arrows:\n');
	console.log(printTable(_arrows, pattern, pattern.length, word, word.length));
	console.log('_diag:\n');
	console.log(printTable(_diag, pattern, pattern.length, word, word.length));
}

function isSeparatorAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}
	const code = value.codePointAt(index);
	switch (code) {
		case CharCode.Underline:	// _
		case CharCode.Dash:			// -
		case CharCode.Period:		// .
		case CharCode.Space:			//' '
		case CharCode.Slash:			// /
		case CharCode.Backslash:	// \
		case CharCode.SingleQuote:	// '
		case CharCode.DoubleQuote:	// "
		case CharCode.Colon:			// :
		case CharCode.DollarSign:	// $
		case CharCode.LessThan:		// <
		case CharCode.GreaterThan:	// >
		case CharCode.OpenParen:				// (
		case CharCode.CloseParen:				// )
		case CharCode.OpenSquareBracket:		// [
		case CharCode.CloseSquareBracket:	// ]
		case CharCode.OpenCurlyBrace:			// {
		case CharCode.CloseCurlyBrace:		// }
			return true;
		case undefined:
			return false;
		default:
			if (strings.isEmojiImprecise(code)) {
				return true;
			}
			return false;
	}
}

function isWhitespaceAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}
	const code = value.charCodeAt(index);
	switch (code) {
		case CharCode.Space:
		case CharCode.Tab:
			return true;
		default:
			return false;
	}
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
	return word[pos] !== wordLow[pos];
}

/**
 * 1. `patternLow` 문자열이 `wordLow` 문자열의 부분 문자열인지 체크
 * 2. `_minWordMatchPos[]`에 패턴 문자 각각이 처음 나타나는 위치 기록
 * @example
 * patternLow   apple
 * wordLow      xappxxlxeeexx
 *               ^^^  ^ ^
 * _minWordMatchPos[0] = 1
 * _minWordMatchPos[1] = 2
 * _minWordMatchPos[2] = 3
 * _minWordMatchPos[3] = 6
 * _minWordMatchPos[4] = 8
 */
export function isPatternInWord(patternLow: string, patternPos: number, patternLen: number, wordLow: string, wordPos: number, wordLen: number, fillMinWordPosArr = false): boolean {
	while (patternPos < patternLen && wordPos < wordLen) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			if (fillMinWordPosArr) {
				// 패턴 글자가 처음으로 나타나는 위치 기록
				_minWordMatchPos[patternPos] = wordPos;
			}
			patternPos += 1;
		}
		wordPos += 1;
	}
	return patternPos === patternLen; // 패턴은 모두 소진되어야 함
}

const enum Arrow { Diag = 1, Left = 2, LeftLeft = 3 }

/**
 * An array representing a fuzzy match.
 *
 * [0] - 퍼지 점수 \
 * [1] - 매칭이 시작되는 오프셋 \
 * [2] - `<match_pos_N>` \
 * [3] - `<match_pos_1>` \
 * [4] - `<match_pos_0>` etc
 */
export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];

export namespace FuzzyScore {
	/**
	 * 아무런 매칭도 없는 경우 (점수: `-100`)
	 */
	export const Default: FuzzyScore = ([-100, 0]);

	export function isDefault(score?: FuzzyScore): score is [-100, 0] {
		return !score || (score.length === 2 && score[0] === -100 && score[1] === 0);
	}
}

export abstract class FuzzyScoreOptions {
	/** `boostFullMatch` = true, \
	 * `firstMatchCanBeWeak` = false  */
	static default = { boostFullMatch: true, firstMatchCanBeWeak: false };

	constructor(
		readonly firstMatchCanBeWeak: boolean,
		readonly boostFullMatch: boolean,
	) { }
}

export interface FuzzyScorer {
	(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined;
}

/**
 * 퍼지 점수 계산
 *
 * `pattern`과 `word` 사이의 유사도 계산
 */
export function fuzzyScore(pattern: string, patternLow: string, patternStart: number, word: string, wordLow: string, wordStart: number, options: FuzzyScoreOptions = FuzzyScoreOptions.default): FuzzyScore | undefined {

	const patternLen = (pattern.length > _maxLen) ? _maxLen : pattern.length;
	const wordLen = (word.length > _maxLen) ? _maxLen : word.length;

	if (patternStart >= patternLen || wordStart >= wordLen || (patternLen - patternStart) > (wordLen - wordStart)) {
		return undefined;
	}

	// Run a simple check if the characters of pattern occur
	// (in order) at all in word. If that isn't the case we
	// stop because no match will be possible
	if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
		return undefined;
	}

	// Find the max matching word position for each pattern position
	// NOTE: the min matching word position was filled in above, in the `isPatternInWord` call
	_fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow);

	let row: number = 1;
	let column: number = 1;
	let patternPos = patternStart;
	let wordPos = wordStart;

	const hasStrongFirstMatch = [false];

	// There will be a match, fill in tables
	for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {

		// Reduce search space to possible matching word positions and to possible access from next row
		const minWordMatchPos = _minWordMatchPos[patternPos];
		const maxWordMatchPos = _maxWordMatchPos[patternPos];
		const nextMaxWordMatchPos = (patternPos + 1 < patternLen) ? _maxWordMatchPos[patternPos + 1] : wordLen;

		for (column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos; wordPos < nextMaxWordMatchPos; column++, wordPos++) {

			let score = Number.MIN_SAFE_INTEGER;
			let canComeDiag = false;

			if (wordPos <= maxWordMatchPos) {
				score = _doScore(
					pattern, patternLow, patternPos, patternStart,
					word, wordLow, wordPos, wordLen, wordStart,
					_diag[row - 1][column - 1] === 0,
					hasStrongFirstMatch
				);
			}

			let diagScore = 0;
			if (score !== Number.MAX_SAFE_INTEGER) {
				canComeDiag = true;
				diagScore = score + _table[row - 1][column - 1];
			}

			const canComeLeft = wordPos > minWordMatchPos;
			const leftScore = canComeLeft ? _table[row][column - 1] + (_diag[row][column - 1] > 0 ? -5 : 0) : 0; // penalty for a gap start

			const canComeLeftLeft = wordPos > minWordMatchPos + 1 && _diag[row][column - 1] > 0;
			const leftLeftScore = canComeLeftLeft ? _table[row][column - 2] + (_diag[row][column - 2] > 0 ? -5 : 0) : 0; // penalty for a gap start

			if (canComeLeftLeft && (!canComeLeft || leftLeftScore >= leftScore) && (!canComeDiag || leftLeftScore >= diagScore)) {
				// always prefer choosing left left to jump over a diagonal because that means a match is earlier in the word
				_table[row][column] = leftLeftScore;
				_arrows[row][column] = Arrow.LeftLeft;
				_diag[row][column] = 0;
			} else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
				// always prefer choosing left since that means a match is earlier in the word
				_table[row][column] = leftScore;
				_arrows[row][column] = Arrow.Left;
				_diag[row][column] = 0;
			} else if (canComeDiag) {
				_table[row][column] = diagScore;
				_arrows[row][column] = Arrow.Diag;
				_diag[row][column] = _diag[row - 1][column - 1] + 1;
			} else {
				throw new Error(`not possible`);
			}
		}
	}

	// 디버깅용
	if (_debug) {
		printTables(pattern, patternStart, word, wordStart);
	}

	if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
		return undefined;
	}

	row--;
	column--;

	const result: FuzzyScore = [_table[row][column], wordStart];

	let backwardsDiagLength = 0;
	let maxMatchColumn = 0;

	while (row >= 1) {
		// Find the column where we go diagonally up
		let diagColumn = column;
		do {
			const arrow = _arrows[row][diagColumn];
			if (arrow === Arrow.LeftLeft) {
				diagColumn = diagColumn - 2;
			} else if (arrow === Arrow.Left) {
				diagColumn = diagColumn - 1;
			} else {
				// found the diagonal
				break;
			}
		} while (diagColumn >= 1);

		// Overturn the "forwards" decision if keeping the "backwards" diagonal would give a better match
		if (
			backwardsDiagLength > 1 // only if we would have a contiguous match of 3 characters
			&& patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1] // only if we can do a contiguous match diagonally
			&& !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) // only if the forwards chose diagonal is not an uppercase
			&& backwardsDiagLength + 1 > _diag[row][diagColumn] // only if our contiguous match would be longer than the "forwards" contiguous match
		) {
			diagColumn = column;
		}

		if (diagColumn === column) {
			// this is a contiguous match
			backwardsDiagLength++;
		} else {
			backwardsDiagLength = 1;
		}

		if (!maxMatchColumn) {
			// remember the last matched column
			maxMatchColumn = diagColumn;
		}

		row--;
		column = diagColumn - 1;
		result.push(column);
	}

	if (wordLen === patternLen && options.boostFullMatch) {
		// the word matches the pattern with all characters!
		// giving the score a total match boost (to come up ahead other words)
		result[0] += 2;
	}

	// Add 1 penalty for each skipped character in the word
	const skippedCharsCount = maxMatchColumn - patternLen;
	result[0] -= skippedCharsCount;

	return result;
}

function _fillInMaxWordMatchPos(patternLen: number, wordLen: number, patternStart: number, wordStart: number, patternLow: string, wordLow: string) {
	let patternPos = patternLen - 1;
	let wordPos = wordLen - 1;
	while (patternPos >= patternStart && wordPos >= wordStart) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			_maxWordMatchPos[patternPos] = wordPos;
			patternPos--;
		}
		wordPos--;
	}
}

function _doScore(
	pattern: string, patternLow: string, patternPos: number, patternStart: number,
	word: string, wordLow: string, wordPos: number, wordLen: number, wordStart: number,
	newMatchStart: boolean,
	outFirstMatchStrong: boolean[],
): number {
	if (patternLow[patternPos] !== wordLow[wordPos]) {
		return Number.MIN_SAFE_INTEGER;
	}

	let score = 1;
	let isGapLocation = false;
	if (wordPos === (patternPos - patternStart)) {
		// common prefix: `foobar <-> foobaz`
		//                            ^^^^^
		score = (pattern[patternPos] === word[wordPos]) ? 7 : 5;

	} else if (isUpperCaseAtPos(wordPos, word, wordLow) && (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))) {
		// hitting upper-case: `foo <-> forOthers`
		//                              ^^ ^
		score = pattern[patternPos] === word[wordPos] ? 7 : 5;
		isGapLocation = true;

	} else if (isSeparatorAtPos(wordLow, wordPos) && (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))) {
		// hitting a separator: `. <-> foo.bar`
		//                                ^
		score = 5;

	} else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
		// post separator: `foo <-> bar_foo`
		//                              ^^^
		score = 5;
		isGapLocation = true;
	}

	if (score > 1 && patternPos === patternStart) {
		outFirstMatchStrong[0] = true;
	}

	if (!isGapLocation) {
		isGapLocation = isUpperCaseAtPos(wordPos, word, wordLow) || isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1);
	}

	//
	if (patternPos === patternStart) { // pattern의 첫 번째 글자인 경우
		if (wordPos > wordStart) {
			// the first pattern character would match a word character that is not at the word start
			// so introduce a penalty to account for the gap preceding this match
			score -= isGapLocation ? 3 : 5;
		}
	} else {
		if (newMatchStart) {
			// 다시 매칭을 시작한 경우 (i.e. 현재 위치 앞에 갭이 있는 경우)
			score += isGapLocation ? 2 : 0;
		} else {
			// 연속으로 매칭한 경우, 보너스 조금 주기, but do so only if it would not be a preferred gap location
			score += isGapLocation ? 0 : 1;
		}
	}

	if (wordPos + 1 === wordLen) {
		// 갭이 있으면 항상 패널티를 줌, but this gives unfair advantages to a match that would match the last character in the word
		// so pretend there is a gap after the last character in the word to normalize things
		score -= isGapLocation ? 3 : 5;
	}

	return score;
}

//#endregion


//#region --- graceful ---

/**
 *  퍼지 점수 계산
 * - `pattern`에서 일부 글자 순서를 바꾼 경우도 고려
 * - aggressive 모드 - `pattern`에서 퍼지 점수를 얻어도 더 나은 퍼지 점수를 갖는 다른 패턴이 있는지 찾아봄
 */
export function fuzzyScoreGracefulAggressive(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined {
	return fuzzyScoreWithPermutations(pattern, lowPattern, patternPos, word, lowWord, wordPos, true, options);
}

/**
 *  퍼지 점수 계산
 * - `pattern`에서 일부 글자 순서를 바꾼 경우도 고려
 * - Non-aggressive 모드 - `pattern`에서 퍼지 점수를 얻으면 더 나은 퍼지 점수를 갖는 다른 패턴이 있는지 찾아보지 않음
 */
export function fuzzyScoreGraceful(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined {
	return fuzzyScoreWithPermutations(pattern, lowPattern, patternPos, word, lowWord, wordPos, false, options);
}

function fuzzyScoreWithPermutations(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, aggressive: boolean, options?: FuzzyScoreOptions): FuzzyScore | undefined {
	let top = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, options);

	if (top && !aggressive) {
		// when using the original pattern yield a result we`
		// return it unless we are aggressive and try to find
		// a better alignment, e.g. `cno` -> `^co^ns^ole` or `^c^o^nsole`.
		return top;
	}

	if (pattern.length >= 3) {
		// When the pattern is long enough then try a few (max 7)
		// permutations of the pattern to find a better match. The
		// permutations only swap neighbouring characters, e.g
		// `cnoso` -> `conso`, `cnsoo`, `cnoos`.
		//              ^^        ^^        ^^
		const tries = Math.min(7, pattern.length - 1);
		for (let movingPatternPos = patternPos + 1; movingPatternPos < tries; movingPatternPos++) {
			const newPattern = nextTypoPermutation(pattern, movingPatternPos);
			if (newPattern) {
				const candidate = fuzzyScore(newPattern, newPattern.toLowerCase(), patternPos, word, lowWord, wordPos, options);
				if (candidate) {
					candidate[0] -= 3; // permutation penalty
					if (!top || candidate[0] > top[0]) {
						top = candidate;
					}
				}
			}
		}
	}

	return top;
}

function nextTypoPermutation(pattern: string, patternPos: number): string | undefined {

	if (patternPos + 1 >= pattern.length) {
		return undefined;
	}

	const swap1 = pattern[patternPos];
	const swap2 = pattern[patternPos + 1];

	if (swap1 === swap2) {
		return undefined;
	}

	return pattern.slice(0, patternPos)
		+ swap2
		+ swap1
		+ pattern.slice(patternPos + 2);
}

//#endregion










//#region --- 바나코 퍼지 ---

function hangulCode(ch: string): number {
	return ch.charCodeAt(0);
}
// function codeToHangul(code: number): string {
// 	return String.fromCharCode(code)
// }

const code가 = hangulCode('가');
const otherBelts = [0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0]; // ㅗ(+ㅘㅙㅚ), ㅜ(+ㅝㅞㅟ), ㅡ(+ㅢ)
// const 초성s = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']; // 19개
// const 중성s = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']; // 21개
// const 종성s = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']; // 28개

const horses: [number, string][] = [
	[0, ''],
	[0, 'ㄱ'],
	[0, 'ㄲ'],
	[1, 'ㅅ'], // ㄳ (악 = 아 + 1)
	[0, 'ㄴ'],
	[4, 'ㅈ'], // ㄵ (안 = 아 + 4)
	[4, 'ㅎ'], // ㄶ (안 = 아 + 4)
	[0, 'ㄷ'],
	[0, 'ㄹ'],
	[8, 'ㄱ'], // ㄺ (알 = 아 + 8)
	[8, 'ㅁ'], // ㄻ (알 = 아 + 8)
	[8, 'ㅂ'], // ㄼ (알 = 아 + 8)
	[8, 'ㅅ'], // ㄽ (알 = 아 + 8)
	[8, 'ㅌ'], // ㄾ (알 = 아 + 8)
	[8, 'ㅍ'], // ㄿ (알 = 아 + 8)
	[8, 'ㅎ'], // ㅀ (알 = 아 + 8)
	[0, 'ㅁ'],
	[0, 'ㅂ'],
	[17, 'ㅅ'], // ㅄ (압 = 아 + 17)
	[0, 'ㅅ'],
	[0, 'ㅆ'],
	[0, 'ㅇ'],
	[0, 'ㅈ'],
	[0, 'ㅊ'],
	[0, 'ㅋ'],
	[0, 'ㅌ'],
	[0, 'ㅍ'],
	[0, 'ㅎ'],
];

// 단독으로 있을 수 있는 자음들 - 유니코드(12593 ~ 12622)
const heads: string[][] = [
	['가'],
	['까'],
	['가', '사'],
	['나'],
	['나', '자'],
	['나', '하'],
	['다'],
	['따'],
	['라'],
	['라', '가'],
	['라', '마'],
	['라', '바'],
	['라', '사'],
	['라', '타'],
	['라', '파'],
	['라', '하'],
	['마'],
	['바'],
	['빠'],
	['바', '사'],
	['사'],
	['싸'],
	['아'],
	['자'],
	['짜'],
	['차'],
	['카'],
	['타'],
	['파'],
	['하'],
];

/** 바나코 퍼지 점수 */
export function banacoScore(
	pat: string, patLow: string, patStart: number,
	word: string, wordLow: string, wordStart: number,
	options: FuzzyScoreOptions = FuzzyScoreOptions.default
): FuzzyScore | undefined {

	const separated = separateLastHangul(pat, patLow); // ToDo: 동일한 패턴에 대해서 word가 달라질 때마다 매번 분리할 필요 없게 수정
	if (separated) {
		// pat: 앙-> 아ㅇ
		const separatedPatScore = _banacoScore(separated[0], separated[1], patStart, word, wordLow, wordStart, options);
		if (separatedPatScore) { // word가 `아ㅇ`과 일치하지 않으면, 맨 아래에서 `앙`으로 점수 계산
			return separatedPatScore;
		}
	}

	return _banacoScore(pat, patLow, patStart, word, wordLow, wordStart, options);
}

function separateLastHangul(pat: string, patLow: string): [string, string] | undefined {

	const endCh = pat.charAt(pat.length - 1);

	// 마지막 글자가 한글인지 체크
	if (!isHangul(endCh)) {
		return undefined;
	}
	// 마지막 글자가 받침이 있는지 체크
	if (!isRiding(endCh)) {
		return undefined;
	}

	// 마지막 글자의 받침 분리
	// 받침이 하나 또는 쌍자음인 경우: '일' -> '이ㄹ' / '있' -> '이ㅆ'
	// 받침이 서로 다른 자음 2개인 경우: '읽' -> '일ㄱ'
	const endChCode = endCh.charCodeAt(0);
	const endChOffset = (endChCode - code가) % 28;
	const [horseRidingOffset, spareHorse] = horses[endChOffset];
	const knight = String.fromCharCode(endChCode - endChOffset + horseRidingOffset);

	return [pat.slice(0, -1) + knight + spareHorse, patLow.slice(0, -1) + knight + spareHorse];
}

function isHangul(ch: string): boolean {
	const chCode = ch.charCodeAt(0);
	return (12593 <= chCode && chCode <= 12622) || (44032 <= chCode && chCode <= 55203);
}

function isRiding(ch: string): boolean {
	const chCode = ch.charCodeAt(0);
	const chOffset = chCode - '가'.charCodeAt(0);
	if ((44032 <= chCode && chCode <= 55203) && chOffset % 28 !== 0) {
		return true;
	}
	return false;
}



/** 바나코 퍼지 점수 계산 */
function _banacoScore(
	pat: string, patLow: string, patStart: number,
	word: string, wordLow: string, wordStart: number,
	options: FuzzyScoreOptions = FuzzyScoreOptions.default
): FuzzyScore | undefined {

	const patLen = pat.length; ///
	const wordLen = word.length; ///

	if (patStart >= patLen || wordStart >= wordLen || (patLen - patStart) > (wordLen - wordStart)) {
		return undefined;
	}

	// 1.pattern에 있는 글자들이 word에 순서대로 다 들어가 있는지 체크
	// 2._minWordMatchPos[] 배열 채우기
	if (!isPatternInWord2(patLow, patStart, patLen, wordLow, wordStart, wordLen, true)) {
		return undefined;
	}
	// _maxWordMatchPos[] 배열 채우기
	_fillInMaxWordMatchPos2(patLen, wordLen, patStart, wordStart, patLow, wordLow);

	let row: number = 1;
	let column: number = 1;
	let patPos = patStart;
	let wordPos = wordStart;

	const hasStrongFirstMatch = [false];

	// 테이블 채우기
	for (row = 1, patPos = patStart; patPos < patLen; row++, patPos++) {

		// 검색 범위 줄이기
		// 매칭 가능한 글자 범위 (minWordMatchPos < wordPos) & 다음 글자 매칭 범위 전 (wordPos < nextMaxWordMatchPos)
		const minWordMatchPos = _minWordMatchPos[patPos];
		const maxWordMatchPos = _maxWordMatchPos[patPos];
		const nextMaxWordMatchPos = (patPos + 1 < patLen) ? _maxWordMatchPos[patPos + 1] : wordLen;

		for (column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos; wordPos < nextMaxWordMatchPos; column++, wordPos++) {

			let score = Number.MIN_SAFE_INTEGER;
			let canComeDiag = false;

			// patLow와 wordLow에서 일치한 문자는 점수 계산
			if (wordPos <= maxWordMatchPos) {
				score = _doScore2(
					pat, patLow, patPos, patStart,
					word, wordLow, wordPos, wordLen, wordStart,
					_diag[row - 1][column - 1] === 0,
					hasStrongFirstMatch
				);
			}

			let diagScore = 0;
			if (score !== Number.MAX_SAFE_INTEGER) {
				canComeDiag = true; // 대각선으로 이동(↘)
				diagScore = score + _table[row - 1][column - 1];
			}

			const canComeLeft = (wordPos > minWordMatchPos);
			const leftScore = canComeLeft ? (_table[row][column - 1] + (_diag[row][column - 1] > 0 ? -5 : 0)) : 0; // penalty for a gap start

			const canComeLeftLeft = (wordPos > minWordMatchPos + 1) && (_diag[row][column - 1] > 0);
			const leftLeftScore = canComeLeftLeft ? (_table[row][column - 2] + (_diag[row][column - 2] > 0 ? -5 : 0)) : 0; // penalty for a gap start

			if (canComeLeftLeft && (!canComeLeft || leftLeftScore >= leftScore) && (!canComeDiag || leftLeftScore >= diagScore)) {
				// always prefer choosing left left to jump over a diagonal because that means a match is earlier in the word
				_table[row][column] = leftLeftScore;
				_arrows[row][column] = Arrow.LeftLeft;
				_diag[row][column] = 0;
			} else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
				// always prefer choosing left since that means a match is earlier in the word
				_table[row][column] = leftScore;
				_arrows[row][column] = Arrow.Left;
				_diag[row][column] = 0;
			} else if (canComeDiag) {
				_table[row][column] = diagScore;
				_arrows[row][column] = Arrow.Diag;
				_diag[row][column] = _diag[row - 1][column - 1] + 1;
			} else {
				throw new Error(`not possible`);
			}
		}
	}

	// 디버깅용
	if (_debug) {
		printTables(pat, patStart, word, wordStart);
	}

	if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
		return undefined;
	}

	//#region --- 반환값(result) 만들기 --------------------------------------------
	row--;
	column--;
	const result: FuzzyScore = [_table[row][column], wordStart];

	let backwardsDiagLength = 0; // 역방향으로 연속 매칭되는 길이
	let maxMatchColumn = 0; // 마지막으로 매칭된 글자가 있는 위치

	while (row >= 1) {
		// 대각선으로 올라갈 column 찾기
		let diagColumn = column;
		do {
			const arrow = _arrows[row][diagColumn];
			if (arrow === Arrow.LeftLeft) {
				diagColumn = diagColumn - 2;
			} else if (arrow === Arrow.Left) {
				diagColumn = diagColumn - 1;
			} else {
				// found the diagonal
				break;
			}
		} while (diagColumn >= 1);

		// `역방향` 매칭(↖)을 계속 하는게 `정방향` 매칭(↘)보다 나으면 역방향 매칭 선택
		if (
			backwardsDiagLength > 1 // 글자 3개가 연속 매칭되고,
			&& patLow[patStart + row - 1] === wordLow[wordStart + column - 1] // 대각선으로 연속 매칭되고,
			&& !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) // 정방향 대각선 글자는 대문자가 아니고,
			&& backwardsDiagLength + 1 > _diag[row][diagColumn] // 역방향 연속 매칭의 길이가 정방향 연속 매칭의 길이보다 긴 경우에만,
		) {
			diagColumn = column;
		}

		if (diagColumn === column) {
			// 연속 매칭인 경우이다
			backwardsDiagLength++;
		} else {
			backwardsDiagLength = 1;
		}

		if (!maxMatchColumn) {
			// 마지막 글자가 매칭되는 column 기억해두기
			maxMatchColumn = diagColumn;
		}

		row--;
		column = diagColumn - 1;
		result.push(column);
	}

	if (wordLen === patLen && options.boostFullMatch) {
		// pattern과 word의 글자가 전부 일치함
		// 다른 단어들보다 위에 나타나도록 퍼지 점수 부스터해주기!
		result[0] += 2;
	}

	// 글자 하나 스킵할 때마다 1점씩 감점
	const skippedCharsCount = maxMatchColumn - patLen;
	result[0] -= skippedCharsCount;
	//#endregion
	return result;
}




/**
 * 1. `patternLow` 문자열이 `wordLow` 문자열의 부분 문자열인지 체크
 * 2. `_minWordMatchPos[]`에 패턴 문자 각각이 처음 나타나는 위치 기록
 * @example
 * patternLow   apple
 * wordLow      xappxxlxeeexx
 *               ^^^  ^ ^
 * _minWordMatchPos[0] = 1
 * _minWordMatchPos[1] = 2
 * _minWordMatchPos[2] = 3
 * _minWordMatchPos[3] = 6
 * _minWordMatchPos[4] = 8
 */
export function isPatternInWord2(patternLow: string, patternPos: number, patternLen: number, wordLow: string, wordPos: number, wordLen: number, fillMinWordPosArr = false): boolean {
	while (patternPos < patternLen && wordPos < wordLen) {
		if (isMatching(patternLow[patternPos], wordLow[wordPos])) {
			if (fillMinWordPosArr) {
				_minWordMatchPos[patternPos] = wordPos; // 패턴 글자가 처음으로 나타나는 위치 기록
			}
			patternPos += 1;
		}
		wordPos += 1;
	}
	return patternPos === patternLen; // 패턴은 모두 소진되어야 함
}

function _fillInMaxWordMatchPos2(patternLen: number, wordLen: number, patternStart: number, wordStart: number, patternLow: string, wordLow: string) {
	let patternPos = patternLen - 1;
	let wordPos = wordLen - 1;
	while (patternPos >= patternStart && wordPos >= wordStart) {
		if (isMatching(patternLow[patternPos], wordLow[wordPos])) {
			_maxWordMatchPos[patternPos] = wordPos;
			patternPos--;
		}
		wordPos--;
	}
}


function _doScore2(
	pattern: string, patternLow: string, patternPos: number, patternStart: number,
	word: string, wordLow: string, wordPos: number, wordLen: number, wordStart: number,
	newMatchStart: boolean,
	outFirstMatchStrong: boolean[],
): number {

	if (!isMatching(patternLow[patternPos], wordLow[wordPos])) {
		return Number.MIN_SAFE_INTEGER;
	}

	let score = 1;
	let isGapLocation = false;
	if (wordPos === (patternPos - patternStart)) {
		// common prefix: `foobar <-> foobaz`
		//                            ^^^^^
		score = isMatching(pattern[patternPos], word[wordPos]) ? 7 : 5;

	} else if (isUpperCaseAtPos(wordPos, word, wordLow) && (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))) {
		// word에서 현재 글자는 대문자이고, 바로 앞에 글자는 대문자가 아닌 경우
		// hitting upper-case: foo <-> forOthers
		//                             ^^ ^
		score = (pattern[patternPos] === word[wordPos]) ? 7 : 5;
		isGapLocation = true;

	} else if (isSeparatorAtPos(wordLow, wordPos) && (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))) {
		// word에서 현재 글자는 구분문자이고, 바로 앞에 글자는 구분문자가 아닌 경우
		// hitting a separator: . <-> foo.bar
		//                               ^
		score = 5;

	} else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
		// word에서 현재 글자의 바로 앞에 글자가 구분문자나, 공백문자인 경우
		// post separator: foo <-> bar_foo
		//                             ^^^
		score = 5;
		isGapLocation = true;
	}

	if (score > 1 && patternPos === patternStart) {
		outFirstMatchStrong[0] = true;
	}

	if (!isGapLocation) {
		isGapLocation = isUpperCaseAtPos(wordPos, word, wordLow) || isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1);
	}

	//
	if (patternPos === patternStart) { // pattern의 첫 번째 글자인 경우
		if (wordPos > wordStart) {
			// the first pattern character would match a word character that is not at the word start
			// so introduce a penalty to account for the gap preceding this match
			score -= isGapLocation ? 3 : 5;
		}
	} else {
		if (newMatchStart) {
			// 다시 매칭을 시작한 경우 (i.e. 현재 위치 앞에 갭이 있는 경우)
			score += isGapLocation ? 2 : 0;
		} else {
			// 연속으로 매칭한 경우, 보너스 조금 주기, but do so only if it would not be a preferred gap location
			score += isGapLocation ? 0 : 1;
		}
	}

	if (wordPos + 1 === wordLen) {
		// 갭이 있으면 항상 패널티를 줌, but this gives unfair advantages to a match that would match the last character in the word
		// so pretend there is a gap after the last character in the word to normalize things
		score -= isGapLocation ? 3 : 5;
	}

	return score;
}


// --- 추가 함수s --------------------------------------------------------------


/** 글자 비교 */
function isMatching(patCh: string, wordCh: string): boolean {

	if (patCh === undefined || wordCh === undefined) {
		return false;
	}

	const patCode = patCh.charCodeAt(0);
	const wordCode = wordCh.charCodeAt(0);

	// 자음만 있는 경우 (ㄱ:12593 - ㅎ:12622)
	if (12593 <= patCode && patCode <= 12622) {
		const jaumArr = heads[patCode - 'ㄱ'.charCodeAt(0)];
		if (jaumArr === undefined) {
			return false;
		}

		if (jaumArr.length === 1) {
			const beginCode = jaumArr[0].charCodeAt(0);
			const endCode = beginCode + 587;
			if (patCh === wordCh || (beginCode <= wordCode && wordCode <= endCode)) {
				return true;
			}
		}
		// ToDo: (jaumArr.length === 2)인 경우 (ㄳ,ㄺ,ㅄ...)
		// else {
		// }
	}

	// 조합 글자인 경우 (가:44032 - 힣:55203)
	if (44032 <= patCode && patCode <= 55203) {
		const codeOffset = hangulCode(patCh) - code가;

		// 초성 + 중성
		if (codeOffset % 28 === 0) {
			// const horseOffset = codeOffset % 28;
			// const beltOffset = ((codeOffset - horseOffset) / 28) % 21;
			// const headOffset = ((codeOffset - horseOffset) / 28 - beltOffset) / 21;
			const beltOffset = (codeOffset / 28) % 21;

			const beginCode = patCh.charCodeAt(0);
			const endCode = beginCode + 27 + (otherBelts[beltOffset] * 28);
			if (beginCode <= wordCode && wordCode <= endCode) {
				return true;
			}
		}

		// 초성 + 중성 + 종성
		if (patCh === wordCh) {
			return true;
		}
	}

	// 한글이 아니면 단순히 비교하고 끝
	return (patCh === wordCh);
}














//#endregion


