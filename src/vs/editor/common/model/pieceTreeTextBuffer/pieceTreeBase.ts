/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요] export
 * export function createLineStartsFast
 * export function createLineStarts
 * export class Piece
 * export class StringBuffer
[*]export class PieceTreeBase
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { FindMatch, ITextSnapshot, SearchData } from 'vs/editor/common/model';
import { NodeColor, SENTINEL, TreeNode, fixInsert, leftest, rbDelete, righttest, updateTreeMetadata } from 'vs/editor/common/model/pieceTreeTextBuffer/rbTreeBase';
import { Searcher, createFindMatch, isValidMatch } from 'vs/editor/common/model/textModelSearch';

// const lfRegex = new RegExp(/\r\n|\r|\n/g);
const AverageBufferSize = 65535;

function createUintArray(arr: number[]): Uint32Array | Uint16Array {
	let r;
	if (arr[arr.length - 1] < 65536) {
		r = new Uint16Array(arr.length);
	} else {
		r = new Uint32Array(arr.length);
	}
	r.set(arr, 0);
	return r;
}

class LineStarts {
	constructor(
		public readonly lineStarts: Uint32Array | Uint16Array | number[],
		public readonly cr: number,
		public readonly lf: number,
		public readonly crlf: number,
		public readonly isBasicASCII: boolean
	) { }
}

/**
 * 아래 내용을 담은 배열 반환
 * - 읽기전용이면, `str`에 있는 줄(line)의 시작 위치를 담은 `Uint16Array(또는 Uint32Array)` (0부터 시작)
 * - 읽기전용이 아니면, `str`에 있는 줄(line)의 시작 위치를 담은 `숫자 배열` (0부터 시작)
 */
export function createLineStartsFast(str: string, readonly: boolean = true): Uint32Array | Uint16Array | number[] {
	const r: number[] = [0];
	let rLength = 1;

	for (let i = 0, len = str.length; i < len; i++) {
		const chr = str.charCodeAt(i);

		if (chr === CharCode.CarriageReturn) {
			// "\r..."인 경우
			if (i + 1 < len && str.charCodeAt(i + 1) === CharCode.LineFeed) {
				// "\r\n..."인 경우
				r[rLength++] = i + 2;
				i++; // '\n' 스킵하기
			} else {
				// "\r..."인 경우
				r[rLength++] = i + 1;
			}
		} else if (chr === CharCode.LineFeed) {
			// "\f..."인 경우
			r[rLength++] = i + 1;
		}
	}
	if (readonly) {
		return createUintArray(r);
	} else {
		return r;
	}
}

/**
 * 아래 내용을 담은 인스턴스 반환
 * - `str`에 있는 줄(line)의 시작 위치를 담은 Uint16Array(또는 Uint32Array) (0부터 시작)
 * - 줄바꿈 문자의 종류와 갯수
 * - 기본 아스키 문자로만 이루졌는지 여부
 */
export function createLineStarts(r: number[], str: string): LineStarts {
	r.length = 0;
	r[0] = 0;
	let rLength = 1; // 줄(line) 갯수
	let cr = 0, lf = 0, crlf = 0; // 줄바꿈 문자별로 갯수 셈
	let isBasicASCII = true; // BasicASCII: 알파벳, 숫자, 특수문자(!?[]...)
	for (let i = 0, len = str.length; i < len; i++) {
		const chr = str.charCodeAt(i);

		if (chr === CharCode.CarriageReturn) {
			// "\r..."인 경우
			if (i + 1 < len && str.charCodeAt(i + 1) === CharCode.LineFeed) {
				// "\r\n..."인 경우
				crlf++;
				r[rLength++] = i + 2;
				i++; // '\n' 스킵하기
			} else {
				// "\r..."인 경우
				cr++;
				r[rLength++] = i + 1;
			}
		} else if (chr === CharCode.LineFeed) {
			// "\f..."인 경우
			lf++;
			r[rLength++] = i + 1;
		} else {
			// 일반 문자인 경우
			if (isBasicASCII) {
				if (chr !== CharCode.Tab && (chr < 32 || chr > 126)) {
					isBasicASCII = false;
				}
			}
		}
	}
	const result = new LineStarts(createUintArray(r), cr, lf, crlf, isBasicASCII);
	r.length = 0;

	return result;
}

interface NodePosition {
	/**
	 * Piece Index
	 */
	node: TreeNode;
	/**
	 * remainder in current piece.
	*/
	remainder: number;
	/**
	 * 문서에서 노드의 시작 오프셋
	 */
	nodeStartOffset: number;
}
/** 버퍼 커서 위치 */
interface BufferCursor {
	/**
	 * 현재 버퍼에서 line 번호
	 */
	line: number;
	/**
	 * 현재 버퍼에서 column 번호
	 */
	column: number;
}

/**
 * 조각
 *
 * -`bufferIndex`: number; - 이 조각과 대응하는 버퍼 배열 원소의 인덱스 \
 * -`start`: BufferCursor; \
 * -`end`: BufferCursor; \
 * -`lineFeedCnt`: number; - 줄바꿈 문자 갯수 \
 * -`length`: number; - `start`부터 `end`까지 문자열의 길이
 */
export class Piece {
	readonly bufferIndex: number;
	readonly start: BufferCursor;
	readonly end: BufferCursor;
	readonly length: number;
	readonly lineFeedCnt: number;

	constructor(bufferIndex: number, start: BufferCursor, end: BufferCursor, lineFeedCnt: number, length: number) {
		this.bufferIndex = bufferIndex;
		this.start = start;
		this.end = end;
		this.lineFeedCnt = lineFeedCnt;
		this.length = length;
	}
}

/**
 * 문자열 버퍼
 *
 * -buffer: 문자열 덩어리(chunk) \
 * -lineStarts: 줄(line) 시작 위치s (0부터 시작)
 */
export class StringBuffer {
	buffer: string;
	lineStarts: Uint32Array | Uint16Array | number[];

	constructor(buffer: string, lineStarts: Uint32Array | Uint16Array | number[]) {
		this.buffer = buffer;
		this.lineStarts = lineStarts;
	}
}

/**
 * Readonly snapshot for piece tree.
 * In a real multiple thread environment, to make snapshot reading always work correctly, we need to
 * 1. Make TreeNode.piece immutable, then reading and writing can run in parallel.
 * 2. TreeNode/Buffers normalization should not happen during snapshot reading.
 */
class PieceTreeSnapshot implements ITextSnapshot {
	private readonly _pieces: Piece[];
	private _index: number;
	private readonly _tree: PieceTreeBase;
	private readonly _BOM: string;

	constructor(tree: PieceTreeBase, BOM: string) {
		this._pieces = [];
		this._tree = tree;
		this._BOM = BOM;
		this._index = 0;
		if (tree.root !== SENTINEL) {
			tree.iterate(tree.root, node => {
				if (node !== SENTINEL) {
					this._pieces.push(node.piece);
				}
				return true;
			});
		}
	}

	read(): string | null {
		if (this._pieces.length === 0) {
			if (this._index === 0) {
				this._index++;
				return this._BOM;
			} else {
				return null;
			}
		}

		if (this._index > this._pieces.length - 1) {
			return null;
		}

		if (this._index === 0) {
			return this._BOM + this._tree.getPieceContent(this._pieces[this._index++]);
		}
		return this._tree.getPieceContent(this._pieces[this._index++]);
	}
}

interface CacheEntry {
	node: TreeNode;
	nodeStartOffset: number; // 문서에서 노드가 가진 문자열의 시작 위치?
	nodeStartLineNumber?: number; // 문서에서 노드가 가진 문자열이 시작하는 줄 번호?
}

/** 조각 트리 검색 캐시? */
class PieceTreeSearchCache {
	private readonly _limit: number; // 캐시 크기
	private _cache: CacheEntry[];

	// 생성자
	constructor(limit: number) {
		this._limit = limit;
		this._cache = [];
	}

	/** 문서에서 `offset` 위치를 담당하는 `CacheEntry` 반환? */
	public get(offset: number): CacheEntry | null {
		for (let i = this._cache.length - 1; i >= 0; i--) {
			const nodePos = this._cache[i];
			if (nodePos.nodeStartOffset <= offset && offset <= nodePos.nodeStartOffset + nodePos.node.piece.length) {
				return nodePos;
			}
		}
		return null;
	}

	/** 문서에서 `lineNumber`번째 줄을 담당하는 `CacheEntry` 반환? */
	public get2(lineNumber: number): { node: TreeNode; nodeStartOffset: number; nodeStartLineNumber: number } | null {
		for (let i = this._cache.length - 1; i >= 0; i--) {
			const nodePos = this._cache[i];
			if (nodePos.nodeStartLineNumber
				&& nodePos.nodeStartLineNumber < lineNumber && lineNumber <= nodePos.nodeStartLineNumber + nodePos.node.piece.lineFeedCnt) {
				return <{ node: TreeNode; nodeStartOffset: number; nodeStartLineNumber: number }>nodePos; // 참고: 타입 표명 https://radlohead.gitbook.io/typescript-deep-dive/type-system/type-assertion
			}
		}
		return null;
	}

	/** 캐시에 `CacheEntry` 추가 */
	public set(nodePosition: CacheEntry) {
		if (this._cache.length >= this._limit) {
			this._cache.shift();
		}
		this._cache.push(nodePosition);
	}

	/** 부모 노드가 없거나, `offset`보다 뒤에서 시작하는 `CacheEntry`는 캐시에서 제거하기? */
	public validate(offset: number) {
		let hasInvalidVal = false;
		const tmp: Array<CacheEntry | null> = this._cache;
		for (let i = 0; i < tmp.length; i++) {
			const nodePos = tmp[i]!;
			if (nodePos.node.parent === null || nodePos.nodeStartOffset >= offset) {
				tmp[i] = null;
				hasInvalidVal = true;
				continue;
			}
		}

		if (hasInvalidVal) {
			const newArr: CacheEntry[] = [];
			for (const entry of tmp) {
				if (entry !== null) {
					newArr.push(entry);
				}
			}

			this._cache = newArr;
		}
	}
}

/** 조각 트리 심은 곳 */
export class PieceTreeBase {
	root!: TreeNode;
	protected _buffers!: StringBuffer[]; // 0 is change buffer, others are readonly original buffer.
	protected _lineCnt!: number;
	protected _length!: number;
	protected _EOL!: '\r\n' | '\n';
	protected _EOLLength!: number;
	protected _EOLNormalized!: boolean;
	private _lastChangeBufferPos!: BufferCursor;
	private _searchCache!: PieceTreeSearchCache;
	private _lastVisitedLine!: { lineNumber: number; value: string };

	// 생성자
	constructor(chunks: StringBuffer[], eol: '\r\n' | '\n', eolNormalized: boolean) {
		this.create(chunks, eol, eolNormalized);
	}

	/** 조각 트리 만들기 및 기본 세팅하기 */
	create(chunks: StringBuffer[], eol: '\r\n' | '\n', eolNormalized: boolean) {
		this.root = SENTINEL;
		this._buffers = [
			new StringBuffer('', [0])
		];
		this._lineCnt = 1;
		this._length = 0;
		this._EOL = eol;
		this._EOLLength = eol.length;
		this._EOLNormalized = eolNormalized;
		this._lastChangeBufferPos = { line: 0, column: 0 };

		// 조각 트리 만들기
		let lastNode: TreeNode | null = null;
		for (let i = 0, len = chunks.length; i < len; i++) {
			if (chunks[i].buffer.length > 0) {
				if (!chunks[i].lineStarts) {
					// lineStarts 배열이 없는 덩어리들은 lineStarts 배열 만들어주기
					chunks[i].lineStarts = createLineStartsFast(chunks[i].buffer);
				}

				const piece = new Piece(
					i + 1,
					{
						line: 0,
						column: 0
					},
					{
						line: chunks[i].lineStarts.length - 1,
						column: chunks[i].buffer.length - chunks[i].lineStarts[chunks[i].lineStarts.length - 1]
					},
					chunks[i].lineStarts.length - 1,
					chunks[i].buffer.length
				);
				this._buffers.push(chunks[i]);
				lastNode = this.rbInsertRight(lastNode, piece);
			}
		}

		this._searchCache = new PieceTreeSearchCache(1);
		this._lastVisitedLine = { lineNumber: 0, value: '' };
		this.computeBufferMetadata();
	}

	/** 줄바꿈 문자 정리하기 */
	normalizeEOL(eol: '\r\n' | '\n') {
		const averageBufferSize = AverageBufferSize;
		const min = averageBufferSize - Math.floor(averageBufferSize / 3);
		const max = min * 2;

		let tempChunk = '';
		let tempChunkLen = 0;
		const chunks: StringBuffer[] = [];

		this.iterate(this.root, node => {
			const str = this.getNodeContent(node);
			const len = str.length;
			if (tempChunkLen <= min || tempChunkLen + len < max) {
				tempChunk += str;
				tempChunkLen += len;
				return true;
			}

			// flush anyways
			const text = tempChunk.replace(/\r\n|\r|\n/g, eol);
			chunks.push(new StringBuffer(text, createLineStartsFast(text)));
			tempChunk = str;
			tempChunkLen = len;
			return true;
		});

		if (tempChunkLen > 0) {
			const text = tempChunk.replace(/\r\n|\r|\n/g, eol);
			chunks.push(new StringBuffer(text, createLineStartsFast(text)));
		}

		this.create(chunks, eol, true);
	}

	// #region 버퍼 API
	public getEOL(): '\r\n' | '\n' {
		return this._EOL;
	}

	public setEOL(newEOL: '\r\n' | '\n'): void {
		this._EOL = newEOL;
		this._EOLLength = this._EOL.length;
		this.normalizeEOL(newEOL);
	}

	public createSnapshot(BOM: string): ITextSnapshot {
		return new PieceTreeSnapshot(this, BOM);
	}

	/** 두 조각 트리에 담긴 버퍼 문자열들이 동일한지 체크 */
	public equal(other: PieceTreeBase): boolean {
		if (this.getLength() !== other.getLength()) {
			return false;
		}
		if (this.getLineCount() !== other.getLineCount()) {
			return false;
		}

		let offset = 0;
		const ret = this.iterate(this.root, node => {
			if (node === SENTINEL) {
				return true;
			}
			const str = this.getNodeContent(node);
			const len = str.length;
			const startPosition = other.nodeAt(offset);
			const endPosition = other.nodeAt(offset + len);
			const val = other.getValueInRange2(startPosition, endPosition);

			offset += len;
			return str === val;
		});

		return ret;
	}

	/** 문서에서 `(lineNumber, column)` 위치의 `offset` 반환 */
	public getOffsetAt(lineNumber: number, column: number): number {
		let leftLen = 0; // inorder, 오프셋 계산용

		let x = this.root;

		while (x !== SENTINEL) {
			if (x.left !== SENTINEL && lineNumber <= x.lf_left + 1) {
				x = x.left;
			} else if (lineNumber <= x.lf_left + x.piece.lineFeedCnt + 1) {
				leftLen += x.size_left;
				// lineNumber >= 2
				const accumualtedValInCurrentIndex = this.getAccumulatedValue(x, lineNumber - x.lf_left - 2);
				return leftLen += accumualtedValInCurrentIndex + column - 1;
			} else {
				lineNumber -= x.lf_left + x.piece.lineFeedCnt;
				leftLen += x.size_left + x.piece.length;
				x = x.right;
			}
		}

		return leftLen;
	}

	/** 문서에서 `offset` 위치의 좌표(`Position`) 반환 */
	public getPositionAt(offset: number): Position {
		offset = Math.floor(offset);
		offset = Math.max(0, offset);

		let x = this.root;
		let lfCnt = 0;
		const originalOffset = offset;

		while (x !== SENTINEL) {
			if (x.size_left !== 0 && offset <= x.size_left) {
				x = x.left;
			} else if (offset <= x.size_left + x.piece.length) {
				const out = this.getIndexOf(x, offset - x.size_left);

				lfCnt += x.lf_left + out.index;

				if (out.index === 0) {
					const lineStartOffset = this.getOffsetAt(lfCnt + 1, 1);
					const column = originalOffset - lineStartOffset;
					return new Position(lfCnt + 1, column + 1);
				}

				return new Position(lfCnt + 1, out.remainder + 1);
			} else {
				offset -= x.size_left + x.piece.length;
				lfCnt += x.lf_left + x.piece.lineFeedCnt;

				if (x.right === SENTINEL) {
					// 마지막 노드인 경우
					const lineStartOffset = this.getOffsetAt(lfCnt + 1, 1);
					const column = originalOffset - offset - lineStartOffset;
					return new Position(lfCnt + 1, column + 1);
				} else {
					x = x.right;
				}
			}
		}

		return new Position(1, 1);
	}

	/** `range` 범위의 버퍼 문자열 반환 */
	public getValueInRange(range: Range, eol?: string): string {
		if (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn) {
			return '';
		}

		const startPosition = this.nodeAt2(range.startLineNumber, range.startColumn);
		const endPosition = this.nodeAt2(range.endLineNumber, range.endColumn);

		const value = this.getValueInRange2(startPosition, endPosition);
		if (eol) {
			if (eol !== this._EOL || !this._EOLNormalized) {
				return value.replace(/\r\n|\r|\n/g, eol);
			}

			if (eol === this.getEOL() && this._EOLNormalized) {
				if (eol === '\r\n') {

				}
				return value;
			}
			return value.replace(/\r\n|\r|\n/g, eol);
		}
		return value;
	}

	/** `startPosition`부터 `endPosition`까지의 버퍼 문자열 반환 */
	public getValueInRange2(startPosition: NodePosition, endPosition: NodePosition): string {
		if (startPosition.node === endPosition.node) {
			// 문자열이 하나의 노드에 다 들어있는 경우
			const node = startPosition.node;
			const buffer = this._buffers[node.piece.bufferIndex].buffer;
			const startOffset = this.offsetInBuffer(node.piece.bufferIndex, node.piece.start);
			return buffer.substring(startOffset + startPosition.remainder, startOffset + endPosition.remainder);
		}

		let x = startPosition.node;
		const buffer = this._buffers[x.piece.bufferIndex].buffer;
		const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);
		let ret = buffer.substring(startOffset + startPosition.remainder, startOffset + x.piece.length);

		x = x.next();
		while (x !== SENTINEL) {
			const buffer = this._buffers[x.piece.bufferIndex].buffer;
			const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);

			if (x === endPosition.node) {
				ret += buffer.substring(startOffset, startOffset + endPosition.remainder);
				break;
			} else {
				ret += buffer.substr(startOffset, x.piece.length);
			}

			x = x.next();
		}

		return ret;
	}

	public getLinesContent(): string[] {
		const lines: string[] = [];
		let linesLength = 0;
		let currentLine = '';
		let danglingCR = false;

		this.iterate(this.root, node => {
			if (node === SENTINEL) {
				return true;
			}

			const piece = node.piece;
			let pieceLength = piece.length;
			if (pieceLength === 0) {
				return true;
			}

			const buffer = this._buffers[piece.bufferIndex].buffer;
			const lineStarts = this._buffers[piece.bufferIndex].lineStarts;

			const pieceStartLine = piece.start.line;
			const pieceEndLine = piece.end.line;
			let pieceStartOffset = lineStarts[pieceStartLine] + piece.start.column;

			if (danglingCR) {
				if (buffer.charCodeAt(pieceStartOffset) === CharCode.LineFeed) {
					// pretend the \n was in the previous piece..
					pieceStartOffset++;
					pieceLength--;
				}
				lines[linesLength++] = currentLine;
				currentLine = '';
				danglingCR = false;
				if (pieceLength === 0) {
					return true;
				}
			}

			if (pieceStartLine === pieceEndLine) {
				// this piece has no new lines
				if (!this._EOLNormalized && buffer.charCodeAt(pieceStartOffset + pieceLength - 1) === CharCode.CarriageReturn) {
					danglingCR = true;
					currentLine += buffer.substr(pieceStartOffset, pieceLength - 1);
				} else {
					currentLine += buffer.substr(pieceStartOffset, pieceLength);
				}
				return true;
			}

			// add the text before the first line start in this piece
			currentLine += (
				this._EOLNormalized
					? buffer.substring(pieceStartOffset, Math.max(pieceStartOffset, lineStarts[pieceStartLine + 1] - this._EOLLength))
					: buffer.substring(pieceStartOffset, lineStarts[pieceStartLine + 1]).replace(/(\r\n|\r|\n)$/, '')
			);
			lines[linesLength++] = currentLine;

			for (let line = pieceStartLine + 1; line < pieceEndLine; line++) {
				currentLine = (
					this._EOLNormalized
						? buffer.substring(lineStarts[line], lineStarts[line + 1] - this._EOLLength)
						: buffer.substring(lineStarts[line], lineStarts[line + 1]).replace(/(\r\n|\r|\n)$/, '')
				);
				lines[linesLength++] = currentLine;
			}

			if (!this._EOLNormalized && buffer.charCodeAt(lineStarts[pieceEndLine] + piece.end.column - 1) === CharCode.CarriageReturn) {
				danglingCR = true;
				if (piece.end.column === 0) {
					// The last line ended with a \r, let's undo the push, it will be pushed by next iteration
					linesLength--;
				} else {
					currentLine = buffer.substr(lineStarts[pieceEndLine], piece.end.column - 1);
				}
			} else {
				currentLine = buffer.substr(lineStarts[pieceEndLine], piece.end.column);
			}

			return true;
		});

		if (danglingCR) {
			lines[linesLength++] = currentLine;
			currentLine = '';
		}

		lines[linesLength++] = currentLine;
		return lines;
	}

	public getLength(): number {
		return this._length;
	}

	public getLineCount(): number {
		return this._lineCnt;
	}

	/** `lineNumber`번째 줄의 문자열 반환 (줄바꿈 문자는 제거해줌) */
	public getLineContent(lineNumber: number): string {
		if (this._lastVisitedLine.lineNumber === lineNumber) {
			return this._lastVisitedLine.value;
		}

		this._lastVisitedLine.lineNumber = lineNumber;

		if (lineNumber === this._lineCnt) {
			this._lastVisitedLine.value = this.getLineRawContent(lineNumber);
		} else if (this._EOLNormalized) {
			this._lastVisitedLine.value = this.getLineRawContent(lineNumber, this._EOLLength);
		} else {
			this._lastVisitedLine.value = this.getLineRawContent(lineNumber).replace(/(\r\n|\r|\n)$/, '');
		}

		return this._lastVisitedLine.value;
	}

	/**  */
	private _getCharCode(nodePos: NodePosition): number {
		if (nodePos.remainder === nodePos.node.piece.length) {
			// 우리가 가져오고 싶은 char가 다음 노드의 선두에 있는 경우
			const matchingNode = nodePos.node.next();
			if (!matchingNode) {
				return 0;
			}

			const buffer = this._buffers[matchingNode.piece.bufferIndex];
			const startOffset = this.offsetInBuffer(matchingNode.piece.bufferIndex, matchingNode.piece.start);
			return buffer.buffer.charCodeAt(startOffset);
		} else {
			const buffer = this._buffers[nodePos.node.piece.bufferIndex];
			const startOffset = this.offsetInBuffer(nodePos.node.piece.bufferIndex, nodePos.node.piece.start);
			const targetOffset = startOffset + nodePos.remainder;

			return buffer.buffer.charCodeAt(targetOffset);
		}
	}

	/** `(lineNumber, index)` 위치에 있는 문자의 CharCode 반환 */
	public getLineCharCode(lineNumber: number, index: number): number {
		const nodePos = this.nodeAt2(lineNumber, index + 1);
		return this._getCharCode(nodePos);
	}

	/** `lineNumber`번째 줄 문자열의 길이 반환 */
	public getLineLength(lineNumber: number): number {
		if (lineNumber === this.getLineCount()) {
			const startOffset = this.getOffsetAt(lineNumber, 1);
			return this.getLength() - startOffset;
		}
		return this.getOffsetAt(lineNumber + 1, 1) - this.getOffsetAt(lineNumber, 1) - this._EOLLength;
	}

	/** `offset` 위치에 있는 문자의 CharCode 반환 */
	public getCharCode(offset: number): number {
		const nodePos = this.nodeAt(offset);
		return this._getCharCode(nodePos);
	}

	/**
	 * 노드에서 검색하기
	 * - 일치 횟수 반환
	 */
	public findMatchesInNode(
		node: TreeNode,
		searcher: Searcher,
		startLineNumber: number, startColumn: number,
		startCursor: BufferCursor, endCursor: BufferCursor,
		searchData: SearchData,
		captureMatches: boolean,
		limitResultCount: number, // 검색 일치 횟수 상한
		resultLen: number, // 검색 일치 횟수
		result: FindMatch[]
	) {
		const buffer = this._buffers[node.piece.bufferIndex];
		const startOffsetInBuffer = this.offsetInBuffer(node.piece.bufferIndex, node.piece.start);
		const start = this.offsetInBuffer(node.piece.bufferIndex, startCursor);
		const end = this.offsetInBuffer(node.piece.bufferIndex, endCursor);

		let m: RegExpExecArray | null;
		// Reset regex to search from the beginning
		const ret: BufferCursor = { line: 0, column: 0 };
		let searchText: string;
		let offsetInBuffer: (offset: number) => number;

		if (searcher._wordSeparators) {
			searchText = buffer.buffer.substring(start, end);
			offsetInBuffer = (offset: number) => offset + start;
			searcher.reset(0);
		} else {
			searchText = buffer.buffer;
			offsetInBuffer = (offset: number) => offset;
			searcher.reset(start);
		}

		do {
			m = searcher.next(searchText);

			if (m) {
				if (offsetInBuffer(m.index) >= end) {
					return resultLen;
				}
				this.positionInBuffer(node, offsetInBuffer(m.index) - startOffsetInBuffer, ret);
				const lineFeedCnt = this.getLineFeedCnt(node.piece.bufferIndex, startCursor, ret);
				const retStartColumn = (ret.line === startCursor.line) ? (ret.column - startCursor.column + startColumn) : (ret.column + 1);
				const retEndColumn = retStartColumn + m[0].length;
				result[resultLen++] = createFindMatch(new Range(startLineNumber + lineFeedCnt, retStartColumn, startLineNumber + lineFeedCnt, retEndColumn), m, captureMatches);

				if (offsetInBuffer(m.index) + m[0].length >= end) {
					return resultLen;
				}
				if (resultLen >= limitResultCount) {
					return resultLen;
				}
			}

		} while (m);

		return resultLen;
	}

	/**  */
	public findMatchesLineByLine(
		searchRange: Range,
		searchData: SearchData,
		captureMatches: boolean,
		limitResultCount: number
	): FindMatch[] {
		const result: FindMatch[] = [];
		let resultLen = 0;
		const searcher = new Searcher(searchData.wordSeparators, searchData.regex);

		let startPosition = this.nodeAt2(searchRange.startLineNumber, searchRange.startColumn);
		if (startPosition === null) {
			return [];
		}
		const endPosition = this.nodeAt2(searchRange.endLineNumber, searchRange.endColumn);
		if (endPosition === null) {
			return [];
		}
		let start = this.positionInBuffer(startPosition.node, startPosition.remainder);
		const end = this.positionInBuffer(endPosition.node, endPosition.remainder);

		if (startPosition.node === endPosition.node) {
			this.findMatchesInNode(startPosition.node, searcher, searchRange.startLineNumber, searchRange.startColumn, start, end, searchData, captureMatches, limitResultCount, resultLen, result);
			return result;
		}

		let startLineNumber = searchRange.startLineNumber;

		let currentNode = startPosition.node;
		while (currentNode !== endPosition.node) {
			const lineBreakCnt = this.getLineFeedCnt(currentNode.piece.bufferIndex, start, currentNode.piece.end);

			if (lineBreakCnt >= 1) {
				// last line break position
				const lineStarts = this._buffers[currentNode.piece.bufferIndex].lineStarts;
				const startOffsetInBuffer = this.offsetInBuffer(currentNode.piece.bufferIndex, currentNode.piece.start);
				const nextLineStartOffset = lineStarts[start.line + lineBreakCnt];
				const startColumn = startLineNumber === searchRange.startLineNumber ? searchRange.startColumn : 1;
				resultLen = this.findMatchesInNode(currentNode, searcher, startLineNumber, startColumn, start, this.positionInBuffer(currentNode, nextLineStartOffset - startOffsetInBuffer), searchData, captureMatches, limitResultCount, resultLen, result);

				if (resultLen >= limitResultCount) {
					return result;
				}

				startLineNumber += lineBreakCnt;
			}

			const startColumn = startLineNumber === searchRange.startLineNumber ? searchRange.startColumn - 1 : 0;
			// search for the remaining content
			if (startLineNumber === searchRange.endLineNumber) {
				const text = this.getLineContent(startLineNumber).substring(startColumn, searchRange.endColumn - 1);
				resultLen = this._findMatchesInLine(searchData, searcher, text, searchRange.endLineNumber, startColumn, resultLen, result, captureMatches, limitResultCount);
				return result;
			}

			resultLen = this._findMatchesInLine(searchData, searcher, this.getLineContent(startLineNumber).substr(startColumn), startLineNumber, startColumn, resultLen, result, captureMatches, limitResultCount);

			if (resultLen >= limitResultCount) {
				return result;
			}

			startLineNumber++;
			startPosition = this.nodeAt2(startLineNumber, 1);
			currentNode = startPosition.node;
			start = this.positionInBuffer(startPosition.node, startPosition.remainder);
		}

		if (startLineNumber === searchRange.endLineNumber) {
			const startColumn = (startLineNumber === searchRange.startLineNumber) ? searchRange.startColumn - 1 : 0;
			const text = this.getLineContent(startLineNumber).substring(startColumn, searchRange.endColumn - 1);
			resultLen = this._findMatchesInLine(searchData, searcher, text, searchRange.endLineNumber, startColumn, resultLen, result, captureMatches, limitResultCount);
			return result;
		}

		const startColumn = (startLineNumber === searchRange.startLineNumber) ? searchRange.startColumn : 1;
		resultLen = this.findMatchesInNode(endPosition.node, searcher, startLineNumber, startColumn, start, end, searchData, captureMatches, limitResultCount, resultLen, result);
		return result;
	}

	/**  */
	private _findMatchesInLine(
		searchData: SearchData,
		searcher: Searcher,
		text: string,
		lineNumber: number,
		deltaOffset: number,
		resultLen: number,
		result: FindMatch[],
		captureMatches: boolean,
		limitResultCount: number
	): number {
		const wordSeparators = searchData.wordSeparators;
		if (!captureMatches && searchData.simpleSearch) {
			const searchString = searchData.simpleSearch;
			const searchStringLen = searchString.length;
			const textLength = text.length;

			let lastMatchIndex = -searchStringLen;
			while ((lastMatchIndex = text.indexOf(searchString, lastMatchIndex + searchStringLen)) !== -1) {
				if (!wordSeparators || isValidMatch(wordSeparators, text, textLength, lastMatchIndex, searchStringLen)) {
					result[resultLen++] = new FindMatch(new Range(lineNumber, lastMatchIndex + 1 + deltaOffset, lineNumber, lastMatchIndex + 1 + searchStringLen + deltaOffset), null);
					if (resultLen >= limitResultCount) {
						return resultLen;
					}
				}
			}
			return resultLen;
		}

		let m: RegExpExecArray | null;
		// Reset regex to search from the beginning
		searcher.reset(0);
		do {
			m = searcher.next(text);
			if (m) {
				result[resultLen++] = createFindMatch(new Range(lineNumber, m.index + 1 + deltaOffset, lineNumber, m.index + 1 + m[0].length + deltaOffset), m, captureMatches);
				if (resultLen >= limitResultCount) {
					return resultLen;
				}
			}
		} while (m);
		return resultLen;
	}

	// #endregion

	// #region 조각 테이블 (Piece Table)
	/** `offset` 위치에 문자열 `value` 삽입하기 */
	public insert(offset: number, value: string, eolNormalized: boolean = false): void {
		this._EOLNormalized = this._EOLNormalized && eolNormalized;
		this._lastVisitedLine.lineNumber = 0;
		this._lastVisitedLine.value = '';

		if (this.root !== SENTINEL) {
			const { node, remainder, nodeStartOffset } = this.nodeAt(offset);
			const piece = node.piece;
			const bufferIndex = piece.bufferIndex;
			const insertPosInBuffer = this.positionInBuffer(node, remainder);
			if (node.piece.bufferIndex === 0 &&
				piece.end.line === this._lastChangeBufferPos.line &&
				piece.end.column === this._lastChangeBufferPos.column &&
				(offset === nodeStartOffset + piece.length) &&
				value.length < AverageBufferSize
			) {
				// changed buffer
				this.appendToNode(node, value);
				this.computeBufferMetadata();
				return;
			}

			if (offset === nodeStartOffset) {
				this.insertContentToNodeLeft(value, node);
				this._searchCache.validate(offset);
			} else if (offset < nodeStartOffset + node.piece.length) {
				// we are inserting into the middle of a node.
				const nodesToDel: TreeNode[] = [];
				let newRightPiece = new Piece(
					piece.bufferIndex,
					insertPosInBuffer,
					piece.end,
					this.getLineFeedCnt(piece.bufferIndex, insertPosInBuffer, piece.end),
					this.offsetInBuffer(bufferIndex, piece.end) - this.offsetInBuffer(bufferIndex, insertPosInBuffer)
				);

				if (this.shouldCheckCRLF() && this.endWithCR(value)) {
					const headOfRight = this.nodeCharCodeAt(node, remainder);

					if (headOfRight === 10 /** \n */) {
						const newStart: BufferCursor = { line: newRightPiece.start.line + 1, column: 0 };
						newRightPiece = new Piece(
							newRightPiece.bufferIndex,
							newStart,
							newRightPiece.end,
							this.getLineFeedCnt(newRightPiece.bufferIndex, newStart, newRightPiece.end),
							newRightPiece.length - 1
						);

						value += '\n';
					}
				}

				// reuse node for content before insertion point.
				if (this.shouldCheckCRLF() && this.startWithLF(value)) {
					const tailOfLeft = this.nodeCharCodeAt(node, remainder - 1);
					if (tailOfLeft === 13 /** \r */) {
						const previousPos = this.positionInBuffer(node, remainder - 1);
						this.deleteNodeTail(node, previousPos);
						value = '\r' + value;

						if (node.piece.length === 0) {
							nodesToDel.push(node);
						}
					} else {
						this.deleteNodeTail(node, insertPosInBuffer);
					}
				} else {
					this.deleteNodeTail(node, insertPosInBuffer);
				}

				const newPieces = this.createNewPieces(value); // 삽입 문자열에 대한 조각들
				if (newRightPiece.length > 0) {
					this.rbInsertRight(node, newRightPiece);
				}
				// 삽입 문자열에 대한 조각들 삽입
				let tmpNode = node;
				for (let k = 0; k < newPieces.length; k++) {
					tmpNode = this.rbInsertRight(tmpNode, newPieces[k]);
				}
				this.deleteNodes(nodesToDel);
			} else {
				this.insertContentToNodeRight(value, node);
			}
		} else {
			// 빈 트리이면 새 노드 삽입
			const pieces = this.createNewPieces(value);
			let node = this.rbInsertLeft(null, pieces[0]);

			for (let k = 1; k < pieces.length; k++) {
				node = this.rbInsertRight(node, pieces[k]);
			}
		}

		// todo, this is too brutal. Total line feed count should be updated the same way as lf_left.
		this.computeBufferMetadata();
	}

	/** `offset` 위치부터 문자 `cnt`개 삭제하기  */
	public delete(offset: number, cnt: number): void {
		this._lastVisitedLine.lineNumber = 0;
		this._lastVisitedLine.value = '';

		if (cnt <= 0 || this.root === SENTINEL) {
			return;
		}

		const startPosition = this.nodeAt(offset);
		const endPosition = this.nodeAt(offset + cnt);
		const startNode = startPosition.node;
		const endNode = endPosition.node;

		if (startNode === endNode) {
			const startSplitPosInBuffer = this.positionInBuffer(startNode, startPosition.remainder);
			const endSplitPosInBuffer = this.positionInBuffer(startNode, endPosition.remainder);

			if (offset === startPosition.nodeStartOffset) {
				if (cnt === startNode.piece.length) {
					// delete node
					const next = startNode.next();
					rbDelete(this, startNode);
					this.validateCRLFWithPrevNode(next);
					this.computeBufferMetadata();
					return;
				}
				this.deleteNodeHead(startNode, endSplitPosInBuffer);
				this._searchCache.validate(offset);
				this.validateCRLFWithPrevNode(startNode);
				this.computeBufferMetadata();
				return;
			}

			if (offset + cnt === startPosition.nodeStartOffset + startNode.piece.length) {
				this.deleteNodeTail(startNode, startSplitPosInBuffer);
				this.validateCRLFWithNextNode(startNode);
				this.computeBufferMetadata();
				return;
			}

			// delete content in the middle, this node will be splitted to nodes
			this.shrinkNode(startNode, startSplitPosInBuffer, endSplitPosInBuffer);
			this.computeBufferMetadata();
			return;
		}

		const nodesToDel: TreeNode[] = [];

		const startSplitPosInBuffer = this.positionInBuffer(startNode, startPosition.remainder);
		this.deleteNodeTail(startNode, startSplitPosInBuffer);
		this._searchCache.validate(offset);
		if (startNode.piece.length === 0) {
			nodesToDel.push(startNode);
		}

		// update last touched node
		const endSplitPosInBuffer = this.positionInBuffer(endNode, endPosition.remainder);
		this.deleteNodeHead(endNode, endSplitPosInBuffer);
		if (endNode.piece.length === 0) {
			nodesToDel.push(endNode);
		}

		// 사이에 있는 노드들 제거
		const secondNode = startNode.next();
		for (let node = secondNode; node !== SENTINEL && node !== endNode; node = node.next()) {
			nodesToDel.push(node);
		}

		const prev = (startNode.piece.length === 0) ? startNode.prev() : startNode;
		this.deleteNodes(nodesToDel);
		this.validateCRLFWithNextNode(prev);
		this.computeBufferMetadata();
	}

	private insertContentToNodeLeft(value: string, node: TreeNode) {
		// we are inserting content to the beginning of node
		const nodesToDel: TreeNode[] = [];
		if (this.shouldCheckCRLF() && this.endWithCR(value) && this.startWithLF(node)) {
			// move `\n` to new node.

			const piece = node.piece;
			const newStart: BufferCursor = { line: piece.start.line + 1, column: 0 };
			const nPiece = new Piece(
				piece.bufferIndex,
				newStart,
				piece.end,
				this.getLineFeedCnt(piece.bufferIndex, newStart, piece.end),
				piece.length - 1
			);

			node.piece = nPiece;

			value += '\n';
			updateTreeMetadata(this, node, -1, -1);

			if (node.piece.length === 0) {
				nodesToDel.push(node);
			}
		}

		const newPieces = this.createNewPieces(value);
		let newNode = this.rbInsertLeft(node, newPieces[newPieces.length - 1]);
		for (let k = newPieces.length - 2; k >= 0; k--) {
			newNode = this.rbInsertLeft(newNode, newPieces[k]);
		}
		this.validateCRLFWithPrevNode(newNode);
		this.deleteNodes(nodesToDel);
	}

	private insertContentToNodeRight(value: string, node: TreeNode) {
		// we are inserting to the right of this node.
		if (this.adjustCarriageReturnFromNext(value, node)) {
			// move \n to the new node.
			value += '\n';
		}

		const newPieces = this.createNewPieces(value);
		const newNode = this.rbInsertRight(node, newPieces[0]);
		let tmpNode = newNode;

		for (let k = 1; k < newPieces.length; k++) {
			tmpNode = this.rbInsertRight(tmpNode, newPieces[k]);
		}

		this.validateCRLFWithPrevNode(newNode);
	}

	private positionInBuffer(node: TreeNode, remainder: number): BufferCursor;
	private positionInBuffer(node: TreeNode, remainder: number, ret: BufferCursor): null;
	private positionInBuffer(node: TreeNode, remainder: number, ret?: BufferCursor): BufferCursor | null {
		const piece = node.piece;
		const bufferIndex = node.piece.bufferIndex;
		const lineStarts = this._buffers[bufferIndex].lineStarts;

		const startOffset = lineStarts[piece.start.line] + piece.start.column;

		const offset = startOffset + remainder;

		// binary search offset between startOffset and endOffset
		let low = piece.start.line;
		let high = piece.end.line;

		let mid: number = 0;
		let midStop: number = 0;
		let midStart: number = 0;

		while (low <= high) {
			mid = low + ((high - low) / 2) | 0;
			midStart = lineStarts[mid];

			if (mid === high) {
				break;
			}

			midStop = lineStarts[mid + 1];

			if (offset < midStart) {
				high = mid - 1;
			} else if (offset >= midStop) {
				low = mid + 1;
			} else {
				break;
			}
		}

		if (ret) {
			ret.line = mid;
			ret.column = offset - midStart;
			return null;
		}

		return {
			line: mid,
			column: offset - midStart
		};
	}

	private getLineFeedCnt(bufferIndex: number, start: BufferCursor, end: BufferCursor): number {
		// we don't need to worry about start: abc\r|\n, or abc|\r, or abc|\n, or abc|\r\n doesn't change the fact that, there is one line break after start.
		// now let's take care of end: abc\r|\n, if end is in between \r and \n, we need to add line feed count by 1
		if (end.column === 0) {
			return end.line - start.line;
		}

		const lineStarts = this._buffers[bufferIndex].lineStarts;
		if (end.line === lineStarts.length - 1) { // it means, there is no \n after end, otherwise, there will be one more lineStart.
			return end.line - start.line;
		}

		const nextLineStartOffset = lineStarts[end.line + 1];
		const endOffset = lineStarts[end.line] + end.column;
		if (nextLineStartOffset > endOffset + 1) { // there are more than 1 character after end, which means it can't be \n
			return end.line - start.line;
		}
		// endOffset + 1 === nextLineStartOffset
		// character at endOffset is \n, so we check the character before first
		// if character at endOffset is \r, end.column is 0 and we can't get here.
		const previousCharOffset = endOffset - 1; // end.column > 0 so it's okay.
		const buffer = this._buffers[bufferIndex].buffer;

		if (buffer.charCodeAt(previousCharOffset) === 13) {
			return end.line - start.line + 1;
		} else {
			return end.line - start.line;
		}
	}

	/**  */
	private offsetInBuffer(bufferIndex: number, cursor: BufferCursor): number {
		const lineStarts = this._buffers[bufferIndex].lineStarts;
		return lineStarts[cursor.line] + cursor.column;
	}

	private deleteNodes(nodes: TreeNode[]): void {
		for (let i = 0; i < nodes.length; i++) {
			rbDelete(this, nodes[i]);
		}
	}

	/** `text`를 담은 새로운 조각들 만들기 */
	private createNewPieces(text: string): Piece[] {
		if (text.length > AverageBufferSize) {
			// 문자열이 너무 길면 substring, charCode 같은 작업들이 느려집니다.
			// 따라서 문자열을 여러개의 덩어리로 나눕니다, just like what we did for CR/LF normalization
			const newPieces: Piece[] = [];
			while (text.length > AverageBufferSize) {
				const lastChar = text.charCodeAt(AverageBufferSize - 1);
				let splitText;
				if (lastChar === CharCode.CarriageReturn || (lastChar >= 0xD800 && lastChar <= 0xDBFF)) {
					// last character is '\r' or a high surrogate => keep it back
					splitText = text.substring(0, AverageBufferSize - 1);
					text = text.substring(AverageBufferSize - 1);
				} else {
					splitText = text.substring(0, AverageBufferSize);
					text = text.substring(AverageBufferSize);
				}

				const lineStarts = createLineStartsFast(splitText);
				newPieces.push(new Piece(
					this._buffers.length, /* buffer index */
					{ line: 0, column: 0 },
					{ line: lineStarts.length - 1, column: splitText.length - lineStarts[lineStarts.length - 1] },
					lineStarts.length - 1,
					splitText.length
				));
				this._buffers.push(new StringBuffer(splitText, lineStarts));
			}

			const lineStarts = createLineStartsFast(text);
			newPieces.push(new Piece(
				this._buffers.length, /* buffer index */
				{ line: 0, column: 0 },
				{ line: lineStarts.length - 1, column: text.length - lineStarts[lineStarts.length - 1] },
				lineStarts.length - 1,
				text.length
			));
			this._buffers.push(new StringBuffer(text, lineStarts));

			return newPieces;
		}

		// 문자열이 길지 않은 경우

		let startOffset = this._buffers[0].buffer.length;
		const lineStarts = createLineStartsFast(text, false);

		let start = this._lastChangeBufferPos;
		if (this._buffers[0].lineStarts[this._buffers[0].lineStarts.length - 1] === startOffset
			&& startOffset !== 0
			&& this.startWithLF(text)
			&& this.endWithCR(this._buffers[0].buffer) // todo, we can check this._lastChangeBufferPos's column as it's the last one
		) {
			this._lastChangeBufferPos = { line: this._lastChangeBufferPos.line, column: this._lastChangeBufferPos.column + 1 };
			start = this._lastChangeBufferPos;

			for (let i = 0; i < lineStarts.length; i++) {
				lineStarts[i] += startOffset + 1;
			}

			this._buffers[0].lineStarts = (<number[]>this._buffers[0].lineStarts).concat(<number[]>lineStarts.slice(1));
			this._buffers[0].buffer += '_' + text;
			startOffset += 1;
		} else {
			if (startOffset !== 0) {
				for (let i = 0; i < lineStarts.length; i++) {
					lineStarts[i] += startOffset;
				}
			}
			this._buffers[0].lineStarts = (<number[]>this._buffers[0].lineStarts).concat(<number[]>lineStarts.slice(1));
			this._buffers[0].buffer += text;
		}

		const endOffset = this._buffers[0].buffer.length;
		const endIndex = this._buffers[0].lineStarts.length - 1;
		const endColumn = endOffset - this._buffers[0].lineStarts[endIndex];
		const endPos = { line: endIndex, column: endColumn };
		const newPiece = new Piece(
			0, /** todo@peng */
			start,
			endPos,
			this.getLineFeedCnt(0, start, endPos),
			endOffset - startOffset
		);
		this._lastChangeBufferPos = endPos;
		return [newPiece];
	}

	/** 조각 트리의 모든 문자열 반환 */
	public getLinesRawContent(): string {
		return this.getContentOfSubTree(this.root);
	}

	/**  */
	public getLineRawContent(lineNumber: number, endOffset: number = 0): string {
		let x = this.root;

		let ret = '';
		const cache = this._searchCache.get2(lineNumber);
		if (cache) {
			x = cache.node;
			const prevAccumulatedValue = this.getAccumulatedValue(x, lineNumber - cache.nodeStartLineNumber - 1);
			const buffer = this._buffers[x.piece.bufferIndex].buffer;
			const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);
			if (cache.nodeStartLineNumber + x.piece.lineFeedCnt === lineNumber) {
				ret = buffer.substring(startOffset + prevAccumulatedValue, startOffset + x.piece.length);
			} else {
				const accumulatedValue = this.getAccumulatedValue(x, lineNumber - cache.nodeStartLineNumber);
				return buffer.substring(startOffset + prevAccumulatedValue, startOffset + accumulatedValue - endOffset);
			}
		} else {
			let nodeStartOffset = 0;
			const originalLineNumber = lineNumber;
			while (x !== SENTINEL) {
				if (x.left !== SENTINEL && x.lf_left >= lineNumber - 1) {
					x = x.left;
				} else if (x.lf_left + x.piece.lineFeedCnt > lineNumber - 1) {
					const prevAccumulatedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 2);
					const accumulatedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 1);
					const buffer = this._buffers[x.piece.bufferIndex].buffer;
					const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);
					nodeStartOffset += x.size_left;
					this._searchCache.set({
						node: x,
						nodeStartOffset,
						nodeStartLineNumber: originalLineNumber - (lineNumber - 1 - x.lf_left)
					});

					return buffer.substring(startOffset + prevAccumulatedValue, startOffset + accumulatedValue - endOffset);
				} else if (x.lf_left + x.piece.lineFeedCnt === lineNumber - 1) {
					const prevAccumulatedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 2);
					const buffer = this._buffers[x.piece.bufferIndex].buffer;
					const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);

					ret = buffer.substring(startOffset + prevAccumulatedValue, startOffset + x.piece.length);
					break;
				} else {
					lineNumber -= x.lf_left + x.piece.lineFeedCnt;
					nodeStartOffset += x.size_left + x.piece.length;
					x = x.right;
				}
			}
		}

		// search in order, to find the node contains end column
		x = x.next();
		while (x !== SENTINEL) {
			const buffer = this._buffers[x.piece.bufferIndex].buffer;

			if (x.piece.lineFeedCnt > 0) {
				const accumulatedValue = this.getAccumulatedValue(x, 0);
				const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);

				ret += buffer.substring(startOffset, startOffset + accumulatedValue - endOffset);
				return ret;
			} else {
				const startOffset = this.offsetInBuffer(x.piece.bufferIndex, x.piece.start);
				ret += buffer.substr(startOffset, x.piece.length);
			}

			x = x.next();
		}

		return ret;
	}

	private computeBufferMetadata() {
		let x = this.root;

		let lfCnt = 1;
		let len = 0;

		while (x !== SENTINEL) {
			lfCnt += x.lf_left + x.piece.lineFeedCnt;
			len += x.size_left + x.piece.length;
			x = x.right;
		}

		this._lineCnt = lfCnt;
		this._length = len;
		this._searchCache.validate(this._length);
	}

	// #region 조각 테이블 - 노드 작업s
	/** 버퍼 내 `accumulatedValue`(오프셋) 위치의 좌표 반환  */
	private getIndexOf(node: TreeNode, accumulatedValue: number): { index: number; remainder: number } {
		const piece = node.piece;
		const pos = this.positionInBuffer(node, accumulatedValue);
		const lineCnt = pos.line - piece.start.line;

		if (accumulatedValue === this.offsetInBuffer(piece.bufferIndex, piece.end) - this.offsetInBuffer(piece.bufferIndex, piece.start)) {
			// we are checking the end of this node, so a CRLF check is necessary.
			const realLineCnt = this.getLineFeedCnt(node.piece.bufferIndex, piece.start, pos);
			if (realLineCnt !== lineCnt) {
				// aha yes, CRLF
				return { index: realLineCnt, remainder: 0 };
			}
		}

		return { index: lineCnt, remainder: pos.column };
	}

	/**  */
	private getAccumulatedValue(node: TreeNode, index: number) {
		if (index < 0) {
			return 0;
		}
		const piece = node.piece;
		const lineStarts = this._buffers[piece.bufferIndex].lineStarts;
		const expectedLineStartIndex = piece.start.line + index + 1;
		if (expectedLineStartIndex > piece.end.line) {
			return lineStarts[piece.end.line] + piece.end.column - lineStarts[piece.start.line] - piece.start.column;
		} else {
			return lineStarts[expectedLineStartIndex] - lineStarts[piece.start.line] - piece.start.column;
		}
	}

	private deleteNodeTail(node: TreeNode, pos: BufferCursor) {
		const piece = node.piece;
		const originalLFCnt = piece.lineFeedCnt;
		const originalEndOffset = this.offsetInBuffer(piece.bufferIndex, piece.end);

		const newEnd = pos;
		const newEndOffset = this.offsetInBuffer(piece.bufferIndex, newEnd);
		const newLineFeedCnt = this.getLineFeedCnt(piece.bufferIndex, piece.start, newEnd);

		const lf_delta = newLineFeedCnt - originalLFCnt;
		const size_delta = newEndOffset - originalEndOffset;
		const newLength = piece.length + size_delta;

		node.piece = new Piece(
			piece.bufferIndex,
			piece.start,
			newEnd,
			newLineFeedCnt,
			newLength
		);

		updateTreeMetadata(this, node, size_delta, lf_delta);
	}

	private deleteNodeHead(node: TreeNode, pos: BufferCursor) {
		const piece = node.piece;
		const originalLFCnt = piece.lineFeedCnt;
		const originalStartOffset = this.offsetInBuffer(piece.bufferIndex, piece.start);

		const newStart = pos;
		const newLineFeedCnt = this.getLineFeedCnt(piece.bufferIndex, newStart, piece.end);
		const newStartOffset = this.offsetInBuffer(piece.bufferIndex, newStart);
		const lf_delta = newLineFeedCnt - originalLFCnt;
		const size_delta = originalStartOffset - newStartOffset;
		const newLength = piece.length + size_delta;
		node.piece = new Piece(
			piece.bufferIndex,
			newStart,
			piece.end,
			newLineFeedCnt,
			newLength
		);

		updateTreeMetadata(this, node, size_delta, lf_delta);
	}

	/**
	 * 노드 중간에 있는 내용 삭제하기
	 * - 두 개의 노드로 분리됨
	 */
	private shrinkNode(node: TreeNode, start: BufferCursor, end: BufferCursor) {
		const piece = node.piece;
		const originalStartPos = piece.start;
		const originalEndPos = piece.end;

		// old piece, originalStartPos, start
		const oldLength = piece.length;
		const oldLFCnt = piece.lineFeedCnt;
		const newEnd = start;
		const newLineFeedCnt = this.getLineFeedCnt(piece.bufferIndex, piece.start, newEnd);
		const newLength = this.offsetInBuffer(piece.bufferIndex, start) - this.offsetInBuffer(piece.bufferIndex, originalStartPos);

		node.piece = new Piece(
			piece.bufferIndex,
			piece.start,
			newEnd,
			newLineFeedCnt,
			newLength
		);

		updateTreeMetadata(this, node, newLength - oldLength, newLineFeedCnt - oldLFCnt);

		// new right piece, end, originalEndPos
		const newPiece = new Piece(
			piece.bufferIndex,
			end,
			originalEndPos,
			this.getLineFeedCnt(piece.bufferIndex, end, originalEndPos),
			this.offsetInBuffer(piece.bufferIndex, originalEndPos) - this.offsetInBuffer(piece.bufferIndex, end)
		);

		const newNode = this.rbInsertRight(node, newPiece);
		this.validateCRLFWithPrevNode(newNode);
	}

	private appendToNode(node: TreeNode, value: string): void {
		if (this.adjustCarriageReturnFromNext(value, node)) {
			value += '\n';
		}

		const hitCRLF = this.shouldCheckCRLF() && this.startWithLF(value) && this.endWithCR(node);
		const startOffset = this._buffers[0].buffer.length;
		this._buffers[0].buffer += value;
		const lineStarts = createLineStartsFast(value, false);
		for (let i = 0; i < lineStarts.length; i++) {
			lineStarts[i] += startOffset;
		}
		if (hitCRLF) {
			const prevStartOffset = this._buffers[0].lineStarts[this._buffers[0].lineStarts.length - 2];
			(<number[]>this._buffers[0].lineStarts).pop();
			// _lastChangeBufferPos is already wrong
			this._lastChangeBufferPos = { line: this._lastChangeBufferPos.line - 1, column: startOffset - prevStartOffset };
		}

		this._buffers[0].lineStarts = (<number[]>this._buffers[0].lineStarts).concat(<number[]>lineStarts.slice(1));
		const endIndex = this._buffers[0].lineStarts.length - 1;
		const endColumn = this._buffers[0].buffer.length - this._buffers[0].lineStarts[endIndex];
		const newEnd = { line: endIndex, column: endColumn };
		const newLength = node.piece.length + value.length;
		const oldLineFeedCnt = node.piece.lineFeedCnt;
		const newLineFeedCnt = this.getLineFeedCnt(0, node.piece.start, newEnd);
		const lf_delta = newLineFeedCnt - oldLineFeedCnt;

		node.piece = new Piece(
			node.piece.bufferIndex,
			node.piece.start,
			newEnd,
			newLineFeedCnt,
			newLength
		);

		this._lastChangeBufferPos = newEnd;
		updateTreeMetadata(this, node, value.length, lf_delta);
	}

	private nodeAt(offset: number): NodePosition {
		let x = this.root;
		const cache = this._searchCache.get(offset);
		if (cache) {
			return {
				node: cache.node,
				nodeStartOffset: cache.nodeStartOffset,
				remainder: offset - cache.nodeStartOffset
			};
		}

		let nodeStartOffset = 0;

		while (x !== SENTINEL) {
			if (x.size_left > offset) {
				x = x.left;
			} else if (x.size_left + x.piece.length >= offset) {
				nodeStartOffset += x.size_left;
				const ret = {
					node: x,
					remainder: offset - x.size_left,
					nodeStartOffset
				};
				this._searchCache.set(ret);
				return ret;
			} else {
				offset -= x.size_left + x.piece.length;
				nodeStartOffset += x.size_left + x.piece.length;
				x = x.right;
			}
		}

		return null!;
	}

	/**  */
	private nodeAt2(lineNumber: number, column: number): NodePosition {
		let x = this.root;
		let nodeStartOffset = 0;

		while (x !== SENTINEL) {
			if (x.left !== SENTINEL && x.lf_left >= lineNumber - 1) {
				x = x.left;
			} else if (x.lf_left + x.piece.lineFeedCnt > lineNumber - 1) {
				const prevAccumualtedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 2);
				const accumulatedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 1);
				nodeStartOffset += x.size_left;

				return {
					node: x,
					remainder: Math.min(prevAccumualtedValue + column - 1, accumulatedValue),
					nodeStartOffset
				};
			} else if (x.lf_left + x.piece.lineFeedCnt === lineNumber - 1) {
				const prevAccumualtedValue = this.getAccumulatedValue(x, lineNumber - x.lf_left - 2);
				if (prevAccumualtedValue + column - 1 <= x.piece.length) {
					return {
						node: x,
						remainder: prevAccumualtedValue + column - 1,
						nodeStartOffset
					};
				} else {
					column -= x.piece.length - prevAccumualtedValue;
					break;
				}
			} else {
				lineNumber -= x.lf_left + x.piece.lineFeedCnt;
				nodeStartOffset += x.size_left + x.piece.length;
				x = x.right;
			}
		}

		// search in order, to find the node contains position.column
		x = x.next();
		while (x !== SENTINEL) {

			if (x.piece.lineFeedCnt > 0) {
				const accumulatedValue = this.getAccumulatedValue(x, 0);
				const nodeStartOffset = this.offsetOfNode(x);
				return {
					node: x,
					remainder: Math.min(column - 1, accumulatedValue),
					nodeStartOffset
				};
			} else {
				if (x.piece.length >= column - 1) {
					const nodeStartOffset = this.offsetOfNode(x);
					return {
						node: x,
						remainder: column - 1,
						nodeStartOffset
					};
				} else {
					column -= x.piece.length;
				}
			}

			x = x.next();
		}

		return null!;
	}

	private nodeCharCodeAt(node: TreeNode, offset: number): number {
		if (node.piece.lineFeedCnt < 1) {
			return -1;
		}
		const buffer = this._buffers[node.piece.bufferIndex];
		const newOffset = this.offsetInBuffer(node.piece.bufferIndex, node.piece.start) + offset;
		return buffer.buffer.charCodeAt(newOffset);
	}

	private offsetOfNode(node: TreeNode): number {
		if (!node) {
			return 0;
		}
		let pos = node.size_left;
		while (node !== this.root) {
			if (node.parent.right === node) {
				pos += node.parent.size_left + node.parent.piece.length;
			}

			node = node.parent;
		}

		return pos;
	}

	// #endregion

	// #region 조각 테이블 - CRLF
	private shouldCheckCRLF() {
		return !(this._EOLNormalized && this._EOL === '\n');
	}

	private startWithLF(val: string | TreeNode): boolean {
		if (typeof val === 'string') {
			return val.charCodeAt(0) === 10;
		}

		if (val === SENTINEL || val.piece.lineFeedCnt === 0) {
			return false;
		}

		const piece = val.piece;
		const lineStarts = this._buffers[piece.bufferIndex].lineStarts;
		const line = piece.start.line;
		const startOffset = lineStarts[line] + piece.start.column;
		if (line === lineStarts.length - 1) {
			// last line, so there is no line feed at the end of this line
			return false;
		}
		const nextLineOffset = lineStarts[line + 1];
		if (nextLineOffset > startOffset + 1) {
			return false;
		}
		return this._buffers[piece.bufferIndex].buffer.charCodeAt(startOffset) === 10;
	}

	private endWithCR(val: string | TreeNode): boolean {
		if (typeof val === 'string') {
			return val.charCodeAt(val.length - 1) === 13;
		}

		if (val === SENTINEL || val.piece.lineFeedCnt === 0) {
			return false;
		}

		return this.nodeCharCodeAt(val, val.piece.length - 1) === 13;
	}

	private validateCRLFWithPrevNode(nextNode: TreeNode) {
		if (this.shouldCheckCRLF() && this.startWithLF(nextNode)) {
			const node = nextNode.prev();
			if (this.endWithCR(node)) {
				this.fixCRLF(node, nextNode);
			}
		}
	}

	private validateCRLFWithNextNode(node: TreeNode) {
		if (this.shouldCheckCRLF() && this.endWithCR(node)) {
			const nextNode = node.next();
			if (this.startWithLF(nextNode)) {
				this.fixCRLF(node, nextNode);
			}
		}
	}

	private fixCRLF(prev: TreeNode, next: TreeNode) {
		const nodesToDel: TreeNode[] = [];
		// update node
		const lineStarts = this._buffers[prev.piece.bufferIndex].lineStarts;
		let newEnd: BufferCursor;
		if (prev.piece.end.column === 0) {
			// it means, last line ends with \r, not \r\n
			newEnd = { line: prev.piece.end.line - 1, column: lineStarts[prev.piece.end.line] - lineStarts[prev.piece.end.line - 1] - 1 };
		} else {
			// \r\n
			newEnd = { line: prev.piece.end.line, column: prev.piece.end.column - 1 };
		}

		const prevNewLength = prev.piece.length - 1;
		const prevNewLFCnt = prev.piece.lineFeedCnt - 1;
		prev.piece = new Piece(
			prev.piece.bufferIndex,
			prev.piece.start,
			newEnd,
			prevNewLFCnt,
			prevNewLength
		);

		updateTreeMetadata(this, prev, - 1, -1);
		if (prev.piece.length === 0) {
			nodesToDel.push(prev);
		}

		// update nextNode
		const newStart: BufferCursor = { line: next.piece.start.line + 1, column: 0 };
		const newLength = next.piece.length - 1;
		const newLineFeedCnt = this.getLineFeedCnt(next.piece.bufferIndex, newStart, next.piece.end);
		next.piece = new Piece(
			next.piece.bufferIndex,
			newStart,
			next.piece.end,
			newLineFeedCnt,
			newLength
		);

		updateTreeMetadata(this, next, - 1, -1);
		if (next.piece.length === 0) {
			nodesToDel.push(next);
		}

		// create new piece which contains \r\n
		const pieces = this.createNewPieces('\r\n');
		this.rbInsertRight(prev, pieces[0]);
		// delete empty nodes

		for (let i = 0; i < nodesToDel.length; i++) {
			rbDelete(this, nodesToDel[i]);
		}
	}

	private adjustCarriageReturnFromNext(value: string, node: TreeNode): boolean {
		if (this.shouldCheckCRLF() && this.endWithCR(value)) {
			const nextNode = node.next();
			if (this.startWithLF(nextNode)) {
				// move `\n` forward
				value += '\n';

				if (nextNode.piece.length === 1) {
					rbDelete(this, nextNode);
				} else {

					const piece = nextNode.piece;
					const newStart: BufferCursor = { line: piece.start.line + 1, column: 0 };
					const newLength = piece.length - 1;
					const newLineFeedCnt = this.getLineFeedCnt(piece.bufferIndex, newStart, piece.end);
					nextNode.piece = new Piece(
						piece.bufferIndex,
						newStart,
						piece.end,
						newLineFeedCnt,
						newLength
					);

					updateTreeMetadata(this, nextNode, -1, -1);
				}
				return true;
			}
		}

		return false;
	}

	// #endregion

	// #endregion

	// #region 트리 작업s
	/** 중위순회하면서 콜백함수 실행? */
	iterate(node: TreeNode, callback: (node: TreeNode) => boolean): boolean {
		if (node === SENTINEL) {
			return callback(SENTINEL);
		}

		const leftRet = this.iterate(node.left, callback);
		if (!leftRet) {
			return leftRet;
		}

		return callback(node) && this.iterate(node.right, callback);
	}

	/** 노드가 담당하는 문자열 얻기 */
	private getNodeContent(node: TreeNode) {
		if (node === SENTINEL) {
			return '';
		}
		const buffer = this._buffers[node.piece.bufferIndex];
		const piece = node.piece;
		const startOffset = this.offsetInBuffer(piece.bufferIndex, piece.start);
		const endOffset = this.offsetInBuffer(piece.bufferIndex, piece.end);
		const currentContent = buffer.buffer.substring(startOffset, endOffset);
		return currentContent;
	}

	/** 조각이 담당하는 문자열 얻기 */
	getPieceContent(piece: Piece) {
		const buffer = this._buffers[piece.bufferIndex];
		const startOffset = this.offsetInBuffer(piece.bufferIndex, piece.start);
		const endOffset = this.offsetInBuffer(piece.bufferIndex, piece.end);
		const currentContent = buffer.buffer.substring(startOffset, endOffset);
		return currentContent;
	}

	/**
	 *      node             node
	 *     /  \    ---->    /  \
	 *    a                a    z (삽입하는 노드)
	 *
	 *      node             node
	 *     /  \             /  \
	 *    a    b   ---->   a    b
	 *                         /
	 *                        z (삽입하는 노드)
	 */
	private rbInsertRight(node: TreeNode | null, p: Piece): TreeNode {
		const z = new TreeNode(p, NodeColor.Red);
		z.left = SENTINEL;
		z.right = SENTINEL;
		z.parent = SENTINEL;
		z.size_left = 0;
		z.lf_left = 0;

		const x = this.root;
		if (x === SENTINEL) {
			this.root = z;
			z.color = NodeColor.Black;
		} else if (node!.right === SENTINEL) {
			node!.right = z;
			z.parent = node!;
		} else {
			const nextNode = leftest(node!.right);
			nextNode.left = z;
			z.parent = nextNode;
		}

		fixInsert(this, z);
		return z;
	}

	/**
	 * 	  node              node
	 *     /  \     ---->    /  \
	 *         b            z    b
	 *
	 *      node              node
	 *     /  \              /  \
	 *    a    b    ---->   a    b
	 *                       \
	 *                        z (삽입하는 노드)
	 */
	private rbInsertLeft(node: TreeNode | null, p: Piece): TreeNode {
		const z = new TreeNode(p, NodeColor.Red);
		z.left = SENTINEL;
		z.right = SENTINEL;
		z.parent = SENTINEL;
		z.size_left = 0;
		z.lf_left = 0;

		if (this.root === SENTINEL) {
			this.root = z;
			z.color = NodeColor.Black;
		} else if (node!.left === SENTINEL) {
			node!.left = z;
			z.parent = node!;
		} else {
			const prevNode = righttest(node!.left); // a
			prevNode.right = z;
			z.parent = prevNode;
		}

		fixInsert(this, z);
		return z;
	}

	private getContentOfSubTree(node: TreeNode): string {
		let str = '';

		this.iterate(node, node => {
			str += this.getNodeContent(node);
			return true;
		});

		return str;
	}
	// #endregion
}
