/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * [요약]
 * 지연 평가 래퍼
 * [개요]
 * export class Lazy<T>
 */

export class Lazy<T> {

	private _didRun: boolean = false;
	private _value?: T; // 게으른 값
	private _error: Error | undefined;

	constructor(
		private readonly executor: () => T,
	) { }

	/**
	 * 값이 결정된(resolved) 경우에는 `True` 반환
	 */
	get hasValue() { return this._didRun; }

	/**
	 * 래핑된 값 반환
	 *
	 * - 값이 아직 결정(resolved)되지 않았으면, 게으른 값을 평가.
	 * - 게으른 값 결정은 단 한 번만 수행됨.
	 * - 값을 결정(resolve)하는 중에 에러가 발상했었다면 똑같은 에러를 다시 던짐.
	 */
	get value(): T {
		if (!this._didRun) {
			try {
				this._value = this.executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}

	/**
	 * 래핑된 값 반환
	 *
	 * - 게으른 값을 평가하지 않음
	 */
	get rawValue(): T | undefined { return this._value; }
}
