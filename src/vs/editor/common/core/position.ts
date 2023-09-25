/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요]
 * export interface IPosition
 * export class Position
 *--------------------------------------------------------------------------------------------*/

/**
 * 에디터에서 위치(position)
 *
 * This interface is suitable for serialization.
 */
export interface IPosition {
	/**
	 * line 번호 (`1`부터 시작)
	 */
	readonly lineNumber: number;
	/**
	 * column 번호 (각 line에서 첫 글자는 column `1`과 column `2` 사이에 있음)
	*/
	readonly column: number;
}

/**
 * 에디터에서 위치(position)
*/
export class Position {
	/**
	 * line 번호 (`1`부터 시작)
	*/
	public readonly lineNumber: number;
	/**
	 * column 번호 (각 line에서 첫 글자는 column `1`과 column `2` 사이에 있음)
	 */
	public readonly column: number;

	constructor(lineNumber: number, column: number) {
		this.lineNumber = lineNumber;
		this.column = column;
	}

	/**
	 * 새로운 Position 만들기
	 *
	 * @param newLineNumber 새로운 line 번호
	 * @param newColumn 새로운 column 번호
	 */
	with(newLineNumber: number = this.lineNumber, newColumn: number = this.column): Position {
		if (newLineNumber === this.lineNumber && newColumn === this.column) {
			return this;
		} else {
			return new Position(newLineNumber, newColumn);
		}
	}

	/**
	 * delta만큼 위치 이동하기
	 *
	 * @param deltaLineNumber line delta
	 * @param deltaColumn column delta
	 */
	delta(deltaLineNumber: number = 0, deltaColumn: number = 0): Position {
		return this.with(this.lineNumber + deltaLineNumber, this.column + deltaColumn);
	}

	/**
	 * position `this`와 position `other`가 동일한지 체크
	 */
	public equals(other: IPosition): boolean {
		return Position.equals(this, other);
	}

	/**
	 * position `a`와 position `b`가 동일한지 체크
	 */
	public static equals(a: IPosition | null, b: IPosition | null): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.lineNumber === b.lineNumber &&
			a.column === b.column
		);
	}

	/**
	 * position `this`가 position `other`보다 앞에 있는지 체크
	 *
	 * 만약에 두 위치가 동일하면 `false` 반환함
	 */
	public isBefore(other: IPosition): boolean {
		return Position.isBefore(this, other);
	}

	/**
	 * position `a`가 position `b`보다 앞에 있는지 체크
	 *
	 * 만약에 두 위치가 동일하면 `false` 반환함
	 */
	public static isBefore(a: IPosition, b: IPosition): boolean {
		if (a.lineNumber < b.lineNumber) {
			return true;
		}
		if (b.lineNumber < a.lineNumber) {
			return false;
		}
		return a.column < b.column;
	}

	/**
	 * position `this`가 position `other`보다 앞에 있는지 체크
	 *
	 * 만약에 두 위치가 동일하면 `true` 반환함
	 */
	public isBeforeOrEqual(other: IPosition): boolean {
		return Position.isBeforeOrEqual(this, other);
	}

	/**
	 * position `a`가 position `b`보다 앞에 있는지 체크
	 *
	 * 만약에 두 위치가 동일하면 `true` 반환함
	 */
	public static isBeforeOrEqual(a: IPosition, b: IPosition): boolean {
		if (a.lineNumber < b.lineNumber) {
			return true;
		}
		if (b.lineNumber < a.lineNumber) {
			return false;
		}
		return a.column <= b.column;
	}

	/**
	 * position 비교하는 함수, 정렬(sort)할 때 유용함.
	 */
	public static compare(a: IPosition, b: IPosition): number {
		const aLineNumber = a.lineNumber | 0;
		const bLineNumber = b.lineNumber | 0;

		if (aLineNumber === bLineNumber) {
			const aColumn = a.column | 0;
			const bColumn = b.column | 0;
			return aColumn - bColumn;
		}

		return aLineNumber - bLineNumber;
	}

	/**
	 * `this` 위치 복제하기
	 */
	public clone(): Position {
		return new Position(this.lineNumber, this.column);
	}

	/**
	 * `"(line번호,column번호)"` 형태의 문자열로 반환 (human-readable)
	 */
	public toString(): string {
		return '(' + this.lineNumber + ',' + this.column + ')';
	}

	// ---

	/**
	 * `IPosition`으로 `Position` 객체 만들기.
	 */
	public static lift(pos: IPosition): Position {
		return new Position(pos.lineNumber, pos.column);
	}

	/**
	 * `obj`가 `IPosition` 인터페이스인지 체크.
	 */
	public static isIPosition(obj: any): obj is IPosition {
		return (
			obj
			&& (typeof obj.lineNumber === 'number')
			&& (typeof obj.column === 'number')
		);
	}
}
