/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * [개요]
 * export class `StopWatch`
 */

// fake definition so that the valid layers check won't trip on this
declare const globalThis: { performance?: { now(): number } };

const hasPerformanceNow = (globalThis.performance && typeof globalThis.performance.now === 'function');

export class StopWatch {

	private _startTime: number;
	private _stopTime: number;

	private readonly _now: () => number;

	/** 스탑워치 만들고, 스탑워치 시작  */
	public static create(highResolution?: boolean): StopWatch {
		return new StopWatch(highResolution);
	}

	/** 스탑워치 만들고, 스탑워치 시작  */
	constructor(highResolution?: boolean) {
		this._now = hasPerformanceNow && highResolution === false ? Date.now : globalThis.performance!.now.bind(globalThis.performance);
		this._startTime = this._now();
		this._stopTime = -1;
	}

	/** 현재 시간을 종료시간으로 기록 */
	public stop(): void {
		this._stopTime = this._now();
	}

	/** 현재 시간을 시작시간으로 설정 */
	public reset(): void {
		this._startTime = this._now();
		this._stopTime = -1;
	}

	/** 스탑워치 경과시간 반환 */
	public elapsed(): number {
		if (this._stopTime !== -1) {
			return this._stopTime - this._startTime;
		}
		return this._now() - this._startTime;
	}
}
