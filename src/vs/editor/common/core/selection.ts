/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요]
 * export interface ISelection
 * export const enum SelectionDirection
 * export class “Selection” extends “Range”
 *--------------------------------------------------------------------------------------------*/

import { IPosition, Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';

/**
 * 에디터에서 선택범위(selection)
 *
 * 선택범위는 방향(orientation)이 있는 범위입니다
 */
export interface ISelection {
	/**
	 * line 번호 on which the selection has started.
	 */
	readonly selectionStartLineNumber: number;
	/**
	 * column 번호 on `selectionStartLineNumber` where the selection has started.
	 */
	readonly selectionStartColumn: number;
	/**
	 * line 번호 on which the selection has ended.
	 */
	readonly positionLineNumber: number;
	/**
	 * column 번호 on `positionLineNumber` where the selection has ended.
	 */
	readonly positionColumn: number;
}

/**
 * 선택범위(selection)의 방향
 */
export const enum SelectionDirection {
	/**
	 * 위에서 아래로 선택함
	 */
	LTR,
	/**
	 * 아래에서 위로 선택함
	 */
	RTL
}

/**
 * 에디터에서 선택범위(selection)
 *
 * 선택범위는 방향(orientation)이 있는 범위입니다
 */
export class Selection extends Range {
	/**
	 * line 번호 on which the selection has started.
	 */
	public readonly selectionStartLineNumber: number;
	/**
	 * column 번호 on `selectionStartLineNumber` where the selection has started.
	 */
	public readonly selectionStartColumn: number;
	/**
	 * line 번호 on which the selection has ended.
	 */
	public readonly positionLineNumber: number;
	/**
	 * column 번호 on `positionLineNumber` where the selection has ended.
	 */
	public readonly positionColumn: number;

	constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number) {
		super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn);
		this.selectionStartLineNumber = selectionStartLineNumber;
		this.selectionStartColumn = selectionStartColumn;
		this.positionLineNumber = positionLineNumber;
		this.positionColumn = positionColumn;
	}

	/**
	 * `"[line,column -> line,column]"` 형태의 문자열로 반환 (human-readable)
	 */
	public override toString(): string {
		return '[' + this.selectionStartLineNumber + ',' + this.selectionStartColumn + ' -> ' + this.positionLineNumber + ',' + this.positionColumn + ']';
	}

	/**
	 * 체크 if equals other selection.
	 */
	public equalsSelection(other: ISelection): boolean {
		return (
			Selection.selectionsEqual(this, other)
		);
	}

	/**
	 * 체크 if the two selections are equal.
	 */
	public static selectionsEqual(a: ISelection, b: ISelection): boolean {
		return (
			a.selectionStartLineNumber === b.selectionStartLineNumber &&
			a.selectionStartColumn === b.selectionStartColumn &&
			a.positionLineNumber === b.positionLineNumber &&
			a.positionColumn === b.positionColumn
		);
	}

	/**
	 * 선택범위 방향 얻기 (`LTR` 또는 `RTL`).
	 */
	public getDirection(): SelectionDirection {
		if (this.selectionStartLineNumber === this.startLineNumber && this.selectionStartColumn === this.startColumn) {
			return SelectionDirection.LTR;
		}
		return SelectionDirection.RTL;
	}

	/**
	 * 새로운 Selection 반환
	 *
	 * 선택 시작 지점은 같고, 종료 지점(`positionLineNumber`, `positionColumn`)이 다른 새로운 선택범위
	 */
	public override setEndPosition(endLineNumber: number, endColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
		}
		return new Selection(endLineNumber, endColumn, this.startLineNumber, this.startColumn);
	}

	/**
	 * 선택 종료 지점(`positionLineNumber`, `positionColumn`) 얻기
	 */
	public getPosition(): Position {
		return new Position(this.positionLineNumber, this.positionColumn);
	}

	/**
	 * 선택 시작 지점 얻기
	 */
	public getSelectionStart(): Position {
		return new Position(this.selectionStartLineNumber, this.selectionStartColumn);
	}

	/**
	 * 새로운 Selection 반환
	 *
	 * Create a new selection with a different `selectionStartLineNumber` and `selectionStartColumn`.
	 */
	public override setStartPosition(startLineNumber: number, startColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
		}
		return new Selection(this.endLineNumber, this.endColumn, startLineNumber, startColumn);
	}

	// ----

	/**
	 * 새로운 Selection 반환
	 *
	 * Create a `Selection` from one or two positions
	 */
	public static override fromPositions(start: IPosition, end: IPosition = start): Selection {
		return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	/**
	 * 새로운 Selection 반환
	 *
	 * Creates a `Selection` from a range, given a direction.
	 */
	public static fromRange(range: Range, direction: SelectionDirection): Selection {
		if (direction === SelectionDirection.LTR) {
			return new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
		} else {
			return new Selection(range.endLineNumber, range.endColumn, range.startLineNumber, range.startColumn);
		}
	}

	/**
	 * `ISelection`으로부터 `Selection` 만들기
	 */
	public static liftSelection(sel: ISelection): Selection {
		return new Selection(sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn);
	}

	/**
	 * 두 선택범위 배열 `a`와 `b`가 동일한지 체크
	 */
	public static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean {
		if (a && !b || !a && b) {
			return false;
		}
		if (!a && !b) {
			return true;
		}
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0, len = a.length; i < len; i++) {
			if (!this.selectionsEqual(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}

	/**
	 * `obj`가 `ISelection`인지 체크
	 */
	public static isISelection(obj: any): obj is ISelection {
		return (
			obj
			&& (typeof obj.selectionStartLineNumber === 'number')
			&& (typeof obj.selectionStartColumn === 'number')
			&& (typeof obj.positionLineNumber === 'number')
			&& (typeof obj.positionColumn === 'number')
		);
	}

	/**
	 * 새로운 Selection 반환
	 * - 선택 방향도 지정함
	 */
	public static createWithDirection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, direction: SelectionDirection): Selection {

		if (direction === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, endLineNumber, endColumn);
		}

		return new Selection(endLineNumber, endColumn, startLineNumber, startColumn);
	}
}
