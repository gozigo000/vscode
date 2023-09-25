/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요]
 *        class `PieceTreeTextBufferFactory` implements ITextBufferFactory
 * export class `PieceTreeTextBufferBuilder` implements ITextBufferBuilder
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { IDisposable } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { DefaultEndOfLine, ITextBuffer, ITextBufferBuilder, ITextBufferFactory } from 'vs/editor/common/model';
import { StringBuffer, createLineStarts, createLineStartsFast } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase';
import { PieceTreeTextBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer';

/** 조각 트리 텍스트 버퍼 팩토리 */
class PieceTreeTextBufferFactory implements ITextBufferFactory {

	constructor(
		private readonly _chunks: StringBuffer[],
		private readonly _bom: string,
		private readonly _cr: number,
		private readonly _lf: number,
		private readonly _crlf: number,
		private readonly _containsRTL: boolean,
		private readonly _containsUnusualLineTerminators: boolean,
		private readonly _isBasicASCII: boolean,
		private readonly _normalizeEOL: boolean
	) { }

	/** 줄바꿈 문자 빈도,기본값에 따라 '\r\n'이나 '\n' 중 하나 반환 */
	private _getEOL(defaultEOL: DefaultEndOfLine): '\r\n' | '\n' {
		const totalEOLCount = this._cr + this._lf + this._crlf;
		const totalCRCount = this._cr + this._crlf;
		if (totalEOLCount === 0) {
			// 빈 파일이거나 한 줄짜리 파일인 경우이다
			return (defaultEOL === DefaultEndOfLine.LF ? '\n' : '\r\n');
		}
		if (totalCRCount > totalEOLCount / 2) {
			// More than half of the file contains \r\n ending lines
			return '\r\n';
		}
		// '\n'으로 끝나는 줄이 하나 이상 있는 경우이다
		return '\n';
	}

	/** 조각 트리 텍스트 버퍼 만들기 */
	public create(defaultEOL: DefaultEndOfLine): { textBuffer: ITextBuffer; disposable: IDisposable } {
		const eol = this._getEOL(defaultEOL);
		const chunks = this._chunks;

		if (this._normalizeEOL &&
			((eol === '\r\n' && (this._cr > 0 || this._lf > 0)) ||
				(eol === '\n' && (this._cr > 0 || this._crlf > 0)))
		) {
			// 줄바꿈 문자 하나로 통일하기 (Normalize pieces)
			for (let i = 0, len = chunks.length; i < len; i++) {
				const str = chunks[i].buffer.replace(/\r\n|\r|\n/g, eol);
				const newLineStart = createLineStartsFast(str);
				chunks[i] = new StringBuffer(str, newLineStart);
			}
		}

		const textBuffer = new PieceTreeTextBuffer(chunks, this._bom, eol, this._containsRTL, this._containsUnusualLineTerminators, this._isBasicASCII, this._normalizeEOL);
		return { textBuffer: textBuffer, disposable: textBuffer };
	}

	/** `첫 번째 덩어리`에서 `첫 줄` 반환 */
	public getFirstLineText(lengthLimit: number): string {
		return this._chunks[0].buffer.substr(0, lengthLimit).split(/\r\n|\r|\n/)[0];
	}
}

/**
 * 조각 트리 텍스트 버퍼 빌더
 * - 문자열 덩어리s 보관
 * - 덩어리별로 줄 갯수, 줄 시작 위치 등도 계산해서 보관해둠
 */
export class PieceTreeTextBufferBuilder implements ITextBufferBuilder {
	private readonly chunks: StringBuffer[];
	private BOM: string;

	private _hasPreviousChar: boolean;
	private _previousChar: number;
	private readonly _tmpLineStarts: number[];

	private cr: number;
	private lf: number;
	private crlf: number;
	private containsRTL: boolean;
	private containsUnusualLineTerminators: boolean;
	private isBasicASCII: boolean;

	constructor() {
		this.chunks = [];
		this.BOM = '';

		this._hasPreviousChar = false;
		this._previousChar = 0;
		this._tmpLineStarts = [];

		this.cr = 0;
		this.lf = 0;
		this.crlf = 0;
		this.containsRTL = false;
		this.containsUnusualLineTerminators = false;
		this.isBasicASCII = true;
	}

	/**
	 * 문자열 덩어리(chunk) 받아서 정리하고 보관해둠
	 * - 오리지날 문자열 덩어리 저장
	 * - 덩어리에서 줄 시작 위치s 저장
	 */
	public acceptChunk(chunk: string): void {
		if (chunk.length === 0) {
			return;
		}

		if (this.chunks.length === 0) {
			// BOM으로 시작하는 문서인지 체크
			if (strings.startsWithUTF8BOM(chunk)) {
				this.BOM = strings.UTF8_BOM_CHARACTER;
				chunk = chunk.substr(1);
			}
		}

		const lastChar = chunk.charCodeAt(chunk.length - 1);
		if (lastChar === CharCode.CarriageReturn || (lastChar >= 0xD800 && lastChar <= 0xDBFF)) {
			// 마지막 문자가 '\r' 또는 high surrogate인 경우 => 나머지만 처리하고, 마지막 문자는 별도로 보관해두기
			this._acceptChunk1(chunk.substr(0, chunk.length - 1), false);
			this._hasPreviousChar = true;
			this._previousChar = lastChar;
		} else {
			this._acceptChunk1(chunk, false);
			this._hasPreviousChar = false;
			this._previousChar = lastChar;
		}
	}

	private _acceptChunk1(chunk: string, allowEmptyStrings: boolean): void {
		if (!allowEmptyStrings && chunk.length === 0) {
			// Nothing to do
			return;
		}

		if (this._hasPreviousChar) {
			// 이전에 보관해둔 마지막 문자랑 함께 처리
			this._acceptChunk2(String.fromCharCode(this._previousChar) + chunk);
		} else {
			this._acceptChunk2(chunk);
		}
	}

	private _acceptChunk2(chunk: string): void {
		const lineStarts = createLineStarts(this._tmpLineStarts, chunk);

		this.chunks.push(new StringBuffer(chunk, lineStarts.lineStarts));
		this.cr += lineStarts.cr;
		this.lf += lineStarts.lf;
		this.crlf += lineStarts.crlf;

		if (!lineStarts.isBasicASCII) {
			// this chunk contains non basic ASCII characters
			this.isBasicASCII = false;
			// ToDo: RTL 관련 코드 지우기
			if (!this.containsRTL) {
				this.containsRTL = strings.containsRTL(chunk);
			}
			if (!this.containsUnusualLineTerminators) {
				this.containsUnusualLineTerminators = strings.containsUnusualLineTerminators(chunk);
			}
		}
	}

	public finish(normalizeEOL: boolean = true): PieceTreeTextBufferFactory {
		this._finish();
		return new PieceTreeTextBufferFactory(
			this.chunks,
			this.BOM,
			this.cr,
			this.lf,
			this.crlf,
			this.containsRTL,
			this.containsUnusualLineTerminators,
			this.isBasicASCII,
			normalizeEOL
		);
	}

	private _finish(): void {
		if (this.chunks.length === 0) {
			this._acceptChunk1('', true);
		}

		if (this._hasPreviousChar) {
			this._hasPreviousChar = false;
			// recreate last chunk
			const lastChunk = this.chunks[this.chunks.length - 1];
			lastChunk.buffer += String.fromCharCode(this._previousChar);
			const newLineStarts = createLineStartsFast(lastChunk.buffer);
			lastChunk.lineStarts = newLineStarts;
			if (this._previousChar === CharCode.CarriageReturn) {
				this.cr++;
			}
		}
	}
}
