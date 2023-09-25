/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * [개요]
 * export interface IRange
 * export class Range
 */

import { IPosition, Position } from 'vs/editor/common/core/position';

/**
 * 에디터에서 범위(range)
 *
 * This interface is suitable for serialization.
 */
export interface IRange {
	/**
	 * range가 시작하는 line 번호 (`1`부터 시작)
	 */
	readonly startLineNumber: number;
	/**
	 * range가 시작하는 line `startLineNumber`에서 Column 번호 (`1`부터 시작)
	 */
	readonly startColumn: number;
	/**
	 * range가 끝나는 line 번호
	 */
	readonly endLineNumber: number;
	/**
	 * range가 끝나는 line `endLineNumber`에서 Column 번호
	 */
	readonly endColumn: number;
}

/**
 * 에디터에서 범위(range)
 * - (start·Line·Number, start·Column) <= (end·Line·Number, end·Column)
 */
export class Range {

	/**
	 * range가 시작하는 line 번호 (`1`부터 시작)
	 */
	public readonly startLineNumber: number;
	/**
	 * range가 시작하는 line `startLineNumber`에서 Column 번호 (`1`부터 시작).
	 */
	public readonly startColumn: number;
	/**
	 * range가 끝나는 line 번호
	 */
	public readonly endLineNumber: number;
	/**
	 * range가 끝나는 line `endLineNumber`에서 Column 번호
	 */
	public readonly endColumn: number;

	constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
		if ((startLineNumber > endLineNumber) || (startLineNumber === endLineNumber && startColumn > endColumn)) {
			this.startLineNumber = endLineNumber;
			this.startColumn = endColumn;
			this.endLineNumber = startLineNumber;
			this.endColumn = startColumn;
		} else {
			this.startLineNumber = startLineNumber;
			this.startColumn = startColumn;
			this.endLineNumber = endLineNumber;
			this.endColumn = endColumn;
		}
	}

	/**
	 * `range`가 0인지 체크
	 */
	public isEmpty(): boolean {
		return Range.isEmpty(this);
	}

	/**
	 * `range`가 0인지 체크
	 */
	public static isEmpty(range: IRange): boolean {
		return (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn);
	}

	/**
	 * `position`이 range `this` 범위 안에 있는지 체크
	 *
	 * - `position`이 경계에 있으면 true 반환
	 */
	public containsPosition(position: IPosition): boolean {
		return Range.containsPosition(this, position);
	}

	/**
	 * `position`이 `range` 범위 안에 있는지 체크
	 *
	 * - `position`이 경계에 있으면 true 반환
	 */
	public static containsPosition(range: IRange, position: IPosition): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
			return false;
		}
		if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
			return false;
		}
		return true;
	}

	/**
	 * `position`이 `range` 범위 안에 있는지 체크
	 *
	 * - `position`이 경계에 있으면 false 반환
	 * @internal
	 */
	public static strictContainsPosition(range: IRange, position: IPosition): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column <= range.startColumn) {
			return false;
		}
		if (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) {
			return false;
		}
		return true;
	}

	/**
	 * `otherRange`가 `this` range 범위 안에 있는지 체크
	 *
	 * - 두 range가 동일하면 true 반환
	 */
	public containsRange(range: IRange): boolean {
		return Range.containsRange(this, range);
	}

	/**
	 * `otherRange`가 `range` 범위 안에 있는지 체크
	 *
	 * - 두 range가 동일하면 true 반환
	 */
	public static containsRange(range: IRange, otherRange: IRange): boolean {
		if (otherRange.startLineNumber < range.startLineNumber || otherRange.endLineNumber < range.startLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber > range.endLineNumber || otherRange.endLineNumber > range.endLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber === range.startLineNumber && otherRange.startColumn < range.startColumn) {
			return false;
		}
		if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn > range.endColumn) {
			return false;
		}
		return true;
	}

	/**
	 * Test if `range` is strictly in this range.
	 *
	 * - `this` range가 `range`보다 먼저 시작하고, 나중에 끝나야만 true 반환.
	 */
	public strictContainsRange(range: IRange): boolean {
		return Range.strictContainsRange(this, range);
	}

	/**
	 * Test if `otherRange` is strictly in `range`
	 *
	 * - `this` range가 `range`보다 먼저 시작하고, 나중에 끝나야만 true 반환
	 * - 두 range가 동일하면 false 반환
	 */
	public static strictContainsRange(range: IRange, otherRange: IRange): boolean {
		if (otherRange.startLineNumber < range.startLineNumber || otherRange.endLineNumber < range.startLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber > range.endLineNumber || otherRange.endLineNumber > range.endLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber === range.startLineNumber && otherRange.startColumn <= range.startColumn) {
			return false;
		}
		if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn >= range.endColumn) {
			return false;
		}
		return true;
	}

	/**
	 * 두 `range` 결합하기
	 *
	 * - 가장 작은 position이 시작점이 되고, 가장 큰 position이 끝점이 됨
	 */
	public plusRange(range: IRange): Range {
		return Range.plusRange(this, range);
	}

	/**
	 * 두 `range` 결합하기
	 *
	 * - 가장 작은 position이 시작점이 되고, 가장 큰 position이 끝점이 됨
	 */
	public static plusRange(a: IRange, b: IRange): Range {
		let startLineNumber: number;
		let startColumn: number;
		let endLineNumber: number;
		let endColumn: number;

		if (b.startLineNumber < a.startLineNumber) {
			startLineNumber = b.startLineNumber;
			startColumn = b.startColumn;
		} else if (b.startLineNumber === a.startLineNumber) {
			startLineNumber = b.startLineNumber;
			startColumn = Math.min(b.startColumn, a.startColumn);
		} else {
			startLineNumber = a.startLineNumber;
			startColumn = a.startColumn;
		}

		if (b.endLineNumber > a.endLineNumber) {
			endLineNumber = b.endLineNumber;
			endColumn = b.endColumn;
		} else if (b.endLineNumber === a.endLineNumber) {
			endLineNumber = b.endLineNumber;
			endColumn = Math.max(b.endColumn, a.endColumn);
		} else {
			endLineNumber = a.endLineNumber;
			endColumn = a.endColumn;
		}

		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	/**
	 * 두 range가 겹치는 범위 구하기
	 */
	public intersectRanges(range: IRange): Range | null {
		return Range.intersectRanges(this, range);
	}

	/**
	 * 두 range가 겹치는 범위 구하기
	 */
	public static intersectRanges(a: IRange, b: IRange): Range | null {
		let resultStartLineNumber = a.startLineNumber;
		let resultStartColumn = a.startColumn;
		let resultEndLineNumber = a.endLineNumber;
		let resultEndColumn = a.endColumn;
		const otherStartLineNumber = b.startLineNumber;
		const otherStartColumn = b.startColumn;
		const otherEndLineNumber = b.endLineNumber;
		const otherEndColumn = b.endColumn;

		if (resultStartLineNumber < otherStartLineNumber) {
			resultStartLineNumber = otherStartLineNumber;
			resultStartColumn = otherStartColumn;
		} else if (resultStartLineNumber === otherStartLineNumber) {
			resultStartColumn = Math.max(resultStartColumn, otherStartColumn);
		}

		if (resultEndLineNumber > otherEndLineNumber) {
			resultEndLineNumber = otherEndLineNumber;
			resultEndColumn = otherEndColumn;
		} else if (resultEndLineNumber === otherEndLineNumber) {
			resultEndColumn = Math.min(resultEndColumn, otherEndColumn);
		}

		// 선택범위(selection)가 0인지 체크
		if (resultStartLineNumber > resultEndLineNumber) {
			return null;
		}
		if (resultStartLineNumber === resultEndLineNumber && resultStartColumn > resultEndColumn) {
			return null;
		}

		return new Range(resultStartLineNumber, resultStartColumn, resultEndLineNumber, resultEndColumn);
	}

	/**
	 * range `this`와 range `other`가 동일한지 체크
	 */
	public equalsRange(other: IRange | null | undefined): boolean {
		return Range.equalsRange(this, other);
	}

	/**
	 * range `a`와 range `b`가 동일한지 체크
	 */
	public static equalsRange(a: IRange | null | undefined, b: IRange | null | undefined): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.startLineNumber === b.startLineNumber &&
			a.startColumn === b.startColumn &&
			a.endLineNumber === b.endLineNumber &&
			a.endColumn === b.endColumn
		);
	}

	/**
	 * 끝나는 위치(position) 반환
	 *
	 * (시작 위치보다 뒤에 있거나 같음)
	 */
	public getEndPosition(): Position {
		return Range.getEndPosition(this);
	}

	/**
	 * 끝나는 위치(position) 반환
	 *
	 * (시작 위치보다 뒤에 있거나 같음)
	 */
	public static getEndPosition(range: IRange): Position {
		return new Position(range.endLineNumber, range.endColumn);
	}

	/**
	 * 시작 위치(position) 반환
	 *
	 * (끝나는 위치보다 앞에 있거나 같음)
	 */
	public getStartPosition(): Position {
		return Range.getStartPosition(this);
	}

	/**
	 * 시작 위치(position) 반환
	 *
	 * (끝나는 위치보다 앞에 있거나 같음)
	 */
	public static getStartPosition(range: IRange): Position {
		return new Position(range.startLineNumber, range.startColumn);
	}

	/**
	 * `"[line,column -> line,column]"` 형태의 문자열로 반환 (user presentable string)
	 */
	public toString(): string {
		return '[' + this.startLineNumber + ',' + this.startColumn + ' -> ' + this.endLineNumber + ',' + this.endColumn + ']';
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new range using `this` range's start position, and using `endLineNumber` and `endColumn` as the end position.
	 */
	public setEndPosition(endLineNumber: number, endColumn: number): Range {
		return new Range(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new range using `this` range's end position, and using `startLineNumber` and `startColumn` as the start position.
	 */
	public setStartPosition(startLineNumber: number, startColumn: number): Range {
		return new Range(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new empty range using `this` range's start position.
	 */
	public collapseToStart(): Range {
		return Range.collapseToStart(this);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new empty range using `this` range's start position.
	 */
	public static collapseToStart(range: IRange): Range {
		return new Range(range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new empty range using `this` range's end position.
	 */
	public collapseToEnd(): Range {
		return Range.collapseToEnd(this);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Create a new empty range using `this` range's end position.
	 */
	public static collapseToEnd(range: IRange): Range {
		return new Range(range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * Moves `this` range by the given amount of lines.
	 */
	public delta(lineCount: number): Range {
		return new Range(this.startLineNumber + lineCount, this.startColumn, this.endLineNumber + lineCount, this.endColumn);
	}

	/**
	 * 새로운 Range 반환
	 *
	 * 시작 위치가 `start`이고, 끝나는 위치가 `end`인 Range 반환
	 */
	public static fromPositions(start: IPosition, end: IPosition = start): Range {
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	/**
	 * `IRange`로부터 `Range` 만들어서 반환
	 */
	public static lift(range: undefined | null): null;
	public static lift(range: IRange): Range;
	public static lift(range: IRange | undefined | null): Range | null;
	public static lift(range: IRange | undefined | null): Range | null {
		if (!range) {
			return null;
		}
		return new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
	}

	/**
	 * `obj`가 `IRange`인지 체크.
	 */
	public static isIRange(obj: any): obj is IRange {
		return (
			obj
			&& (typeof obj.startLineNumber === 'number')
			&& (typeof obj.startColumn === 'number')
			&& (typeof obj.endLineNumber === 'number')
			&& (typeof obj.endColumn === 'number')
		);
	}

	/**
	 * 두 range가 서로 겹치거나 만나는지 체크
	 */
	public static areIntersectingOrTouching(a: IRange, b: IRange): boolean {
		// Check if `a` is before `b`
		if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn)) {
			return false;
		}

		// Check if `b` is before `a`
		if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn)) {
			return false;
		}

		// These ranges must intersect
		return true;
	}

	/**
	 * 두 range가 서로 겹치는지 체크
	 *
	 * - 두 range의 끝이 만나기만 하는 경우에는 false 반환.
	 */
	public static areIntersecting(a: IRange, b: IRange): boolean {
		// Check if `a` is before `b`
		if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn <= b.startColumn)) {
			return false;
		}

		// Check if `b` is before `a`
		if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn <= a.startColumn)) {
			return false;
		}

		// These ranges must intersect
		return true;
	}

	/**
	 * range 비교하는 함수, 정렬(sort)할 때 유용함
	 * - 비교 우선순위 :
	 * 1. start Line Number
	 * 2. start Column
	 * 3. end Line Number
	 * 4. end Column
	 */
	public static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number {
		if (a && b) {
			const aStartLineNumber = a.startLineNumber | 0;
			const bStartLineNumber = b.startLineNumber | 0;

			if (aStartLineNumber === bStartLineNumber) {
				const aStartColumn = a.startColumn | 0;
				const bStartColumn = b.startColumn | 0;

				if (aStartColumn === bStartColumn) {
					const aEndLineNumber = a.endLineNumber | 0;
					const bEndLineNumber = b.endLineNumber | 0;

					if (aEndLineNumber === bEndLineNumber) {
						const aEndColumn = a.endColumn | 0;
						const bEndColumn = b.endColumn | 0;
						return aEndColumn - bEndColumn;
					}
					return aEndLineNumber - bEndLineNumber;
				}
				return aStartColumn - bStartColumn;
			}
			return aStartLineNumber - bStartLineNumber;
		}
		const aExists = (a ? 1 : 0);
		const bExists = (b ? 1 : 0);
		return aExists - bExists;
	}

	/**
	 * range 비교하는 함수, 정렬(sort)할 때 유용함
	 * - 비교 우선순위 :
	 * 1. end Line Number
	 * 2. end Column
	 * 3. start Line Number
	 * 4. start Column
	 */
	public static compareRangesUsingEnds(a: IRange, b: IRange): number {
		if (a.endLineNumber === b.endLineNumber) {
			if (a.endColumn === b.endColumn) {
				if (a.startLineNumber === b.startLineNumber) {
					return a.startColumn - b.startColumn;
				}
				return a.startLineNumber - b.startLineNumber;
			}
			return a.endColumn - b.endColumn;
		}
		return a.endLineNumber - b.endLineNumber;
	}

	/**
	 * `range`가 여러줄에 걸쳐 있는지 체크
	 */
	public static spansMultipleLines(range: IRange): boolean {
		return range.endLineNumber > range.startLineNumber;
	}

	public toJSON(): IRange {
		return this;
	}
}
