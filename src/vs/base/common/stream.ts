/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedError } from 'vs/base/common/errors';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';

/**
 * The payload that flows in readable stream events.
 * - 참고: https://ko.wikipedia.org/wiki/페이로드_(컴퓨팅)
 *
 */
export type ReadableStreamEventPayload<T> = T | Error | 'end';

export interface ReadableStreamEvents<T> {

	/**
	 * `data`이벤트는 스트림이 소비자(consumer)에게 데이터 덩어리의
	 * 소유권을 양도할 때마다 방출됩니다.
	 *
	 * - 주의: DATA 리스너를 추가하는 것은 스트림을 흐름 모드(FLOWING
	 * MODE)로 전환할 수 있습니다. 따라서, 추가되어야 하는 리스너는
	 * 첫 번째 리스너가 아니라 마지막 리스너입니다.
	 *
	 * - 스트림 이벤트를 올바른 순서대로 들을 수 있도록 `listenStream`을
	 * 헬퍼 메서드로 사용하세요
	 */
	on(event: 'data', callback: (data: T) => void): void;

	/**
	 * `error`이벤트는 에러가 발생할 때마다 방출됩니다.
	 */
	on(event: 'error', callback: (err: Error) => void): void;

	/**
	 * `end`이벤트는 스트림에서 더 이상 소비(consume)할 데이터가 없을 때 방출됩니다.
	 * - 데이터가 완전히 소비되기 전까지 `end`이벤트는 방출되지 않습니다.
	 */
	on(event: 'end', callback: () => void): void;
}

/**
 * 네이티브 및 웹 환경에서 사용하기 위한 node.js readable 스트림의
 * API 형태를 에뮬레이트하는 인터페이스입니다.
 */
export interface ReadableStream<T> extends ReadableStreamEvents<T> {

	/**
	 * resume()이 호출되기 전까지 어떠한 이벤트도 방출하지 않습니다.
	 */
	pause(): void;

	/**
	 * pause()가 호출되어 이벤트 방출이 멈춘 상태에서 다시 이벤트를 방출하기 시작합니다.
	 */
	resume(): void;

	/**
	 * 스트림을 파괴하고, 모든 이벤트 방출을 멈춥니다.
	 */
	destroy(): void;

	/**
	 * 이전에 추가되었던 리스너를 제거합니다.
	 */
	removeListener(event: string, callback: Function): void;
}

/**
 * 네이티브 및 웹 환경에서 사용하기 위한 node.js readable의 API 형태를
 * 에뮬레이트하는 인터페이스입니다.
 */
export interface Readable<T> {

	/**
	 * 기본 소스(underlying source)에서 데이터를 읽습니다.
	 * - 더 이상 데이터를 읽을 수 없으면 null을 반환합니다.
	 */
	read(): T | null;
}

export function isReadable<T>(obj: unknown): obj is Readable<T> {
	const candidate = obj as Readable<T> | undefined;
	if (!candidate) {
		return false;
	}

	return typeof candidate.read === 'function';
}

/**
 * 네이티브 및 웹 환경에서 사용하기 위한 node.js writeable 스트림의 API 형태를
 * 에뮬레이트하는 인터페이스입니다.
 */
export interface WriteableStream<T> extends ReadableStream<T> {

	/**
	 * Writing data to the stream will trigger the on('data')
	 * event listener if the stream is flowing and buffer the
	 * data otherwise until the stream is flowing.
	 *
	 * If a `highWaterMark` is configured and writing to the
	 * stream reaches this mark, a promise will be returned
	 * that should be awaited on before writing more data.
	 * Otherwise there is a risk of buffering a large number
	 * of data chunks without consumer.
	 */
	write(data: T): void | Promise<void>;

	/**
	 * Signals an error to the consumer of the stream via the
	 * on('error') handler if the stream is flowing.
	 *
	 * NOTE: call `end` to signal that the stream has ended,
	 * this DOES NOT happen automatically from `error`.
	 */
	error(error: Error): void;

	/**
	 * Signals the end of the stream to the consumer. If the
	 * result is provided, will trigger the on('data') event
	 * listener if the stream is flowing and buffer the data
	 * otherwise until the stream is flowing.
	 */
	end(result?: T): void;
}

/**
 * A stream that has a buffer already read. Returns the original stream
 * that was read as well as the chunks that got read.
 *
 * The `ended` flag indicates if the stream has been fully consumed.
 */
export interface ReadableBufferedStream<T> {

	/**
	 * The original stream that is being read.
	 */
	stream: ReadableStream<T>;

	/**
	 * An array of chunks already read from this stream.
	 */
	buffer: T[];

	/**
	 * Signals if the stream has ended or not. If not, consumers
	 * should continue to read from the stream until consumed.
	 */
	ended: boolean;
}

export function isReadableStream<T>(obj: unknown): obj is ReadableStream<T> {
	const candidate = obj as ReadableStream<T> | undefined;
	if (!candidate) {
		return false;
	}

	return [candidate.on, candidate.pause, candidate.resume, candidate.destroy].every(fn => typeof fn === 'function');
}

export function isReadableBufferedStream<T>(obj: unknown): obj is ReadableBufferedStream<T> {
	const candidate = obj as ReadableBufferedStream<T> | undefined;
	if (!candidate) {
		return false;
	}

	return isReadableStream(candidate.stream) && Array.isArray(candidate.buffer) && typeof candidate.ended === 'boolean';
}

export interface IReducer<T, R = T> {
	(data: T[]): R;
}

export interface IDataTransformer<Original, Transformed> {
	(data: Original): Transformed;
}

export interface IErrorTransformer {
	(error: Error): Error;
}

export interface ITransformer<Original, Transformed> {
	data: IDataTransformer<Original, Transformed>;
	error?: IErrorTransformer;
}

export function newWriteableStream<T>(reducer: IReducer<T>, options?: WriteableStreamOptions): WriteableStream<T> {
	return new WriteableStreamImpl<T>(reducer, options);
}

export interface WriteableStreamOptions {

	/**
	 * The number of objects to buffer before WriteableStream#write()
	 * signals back that the buffer is full. Can be used to reduce
	 * the memory pressure when the stream is not flowing.
	 */
	highWaterMark?: number;
}

class WriteableStreamImpl<T> implements WriteableStream<T> {

	private readonly state = {
		flowing: false,
		ended: false,
		destroyed: false
	};

	private readonly buffer = {
		data: [] as T[],
		error: [] as Error[]
	};

	private readonly listeners = {
		data: [] as { (data: T): void }[],
		error: [] as { (error: Error): void }[],
		end: [] as { (): void }[]
	};

	private readonly pendingWritePromises: Function[] = [];

	constructor(private reducer: IReducer<T>, private options?: WriteableStreamOptions) { }

	pause(): void {
		if (this.state.destroyed) {
			return;
		}

		this.state.flowing = false;
	}

	resume(): void {
		if (this.state.destroyed) {
			return;
		}

		if (!this.state.flowing) {
			this.state.flowing = true;

			// emit buffered events
			this.flowData();
			this.flowErrors();
			this.flowEnd();
		}
	}

	write(data: T): void | Promise<void> {
		if (this.state.destroyed) {
			return;
		}

		// flowing: directly send the data to listeners
		if (this.state.flowing) {
			this.emitData(data);
		}

		// not yet flowing: buffer data until flowing
		else {
			this.buffer.data.push(data);

			// highWaterMark: if configured, signal back when buffer reached limits
			if (typeof this.options?.highWaterMark === 'number' && this.buffer.data.length > this.options.highWaterMark) {
				return new Promise(resolve => this.pendingWritePromises.push(resolve));
			}
		}
	}

	error(error: Error): void {
		if (this.state.destroyed) {
			return;
		}

		// flowing: directly send the error to listeners
		if (this.state.flowing) {
			this.emitError(error);
		}

		// not yet flowing: buffer errors until flowing
		else {
			this.buffer.error.push(error);
		}
	}

	end(result?: T): void {
		if (this.state.destroyed) {
			return;
		}

		// end with data if provided
		if (typeof result !== 'undefined') {
			this.write(result);
		}

		// flowing: send end event to listeners
		if (this.state.flowing) {
			this.emitEnd();

			this.destroy();
		}

		// not yet flowing: remember state
		else {
			this.state.ended = true;
		}
	}

	private emitData(data: T): void {
		this.listeners.data.slice(0).forEach(listener => listener(data)); // slice to avoid listener mutation from delivering event
	}

	private emitError(error: Error): void {
		if (this.listeners.error.length === 0) {
			onUnexpectedError(error); // nobody listened to this error so we log it as unexpected
		} else {
			this.listeners.error.slice(0).forEach(listener => listener(error)); // slice to avoid listener mutation from delivering event
		}
	}

	private emitEnd(): void {
		this.listeners.end.slice(0).forEach(listener => listener()); // slice to avoid listener mutation from delivering event
	}

	on(event: 'data', callback: (data: T) => void): void;
	on(event: 'error', callback: (err: Error) => void): void;
	on(event: 'end', callback: () => void): void;
	on(event: 'data' | 'error' | 'end', callback: (arg0?: any) => void): void {
		if (this.state.destroyed) {
			return;
		}

		switch (event) {
			case 'data':
				this.listeners.data.push(callback);

				// switch into flowing mode as soon as the first 'data'
				// listener is added and we are not yet in flowing mode
				this.resume();

				break;

			case 'end':
				this.listeners.end.push(callback);

				// emit 'end' event directly if we are flowing
				// and the end has already been reached
				//
				// finish() when it went through
				if (this.state.flowing && this.flowEnd()) {
					this.destroy();
				}

				break;

			case 'error':
				this.listeners.error.push(callback);

				// emit buffered 'error' events unless done already
				// now that we know that we have at least one listener
				if (this.state.flowing) {
					this.flowErrors();
				}

				break;
		}
	}

	removeListener(event: string, callback: Function): void {
		if (this.state.destroyed) {
			return;
		}

		let listeners: unknown[] | undefined = undefined;

		switch (event) {
			case 'data':
				listeners = this.listeners.data;
				break;

			case 'end':
				listeners = this.listeners.end;
				break;

			case 'error':
				listeners = this.listeners.error;
				break;
		}

		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index >= 0) {
				listeners.splice(index, 1);
			}
		}
	}

	private flowData(): void {
		if (this.buffer.data.length > 0) {
			const fullDataBuffer = this.reducer(this.buffer.data);

			this.emitData(fullDataBuffer);

			this.buffer.data.length = 0;

			// When the buffer is empty, resolve all pending writers
			const pendingWritePromises = [...this.pendingWritePromises];
			this.pendingWritePromises.length = 0;
			pendingWritePromises.forEach(pendingWritePromise => pendingWritePromise());
		}
	}

	private flowErrors(): void {
		if (this.listeners.error.length > 0) {
			for (const error of this.buffer.error) {
				this.emitError(error);
			}

			this.buffer.error.length = 0;
		}
	}

	private flowEnd(): boolean {
		if (this.state.ended) {
			this.emitEnd();

			return this.listeners.end.length > 0;
		}

		return false;
	}

	destroy(): void {
		if (!this.state.destroyed) {
			this.state.destroyed = true;
			this.state.ended = true;

			this.buffer.data.length = 0;
			this.buffer.error.length = 0;

			this.listeners.data.length = 0;
			this.listeners.error.length = 0;
			this.listeners.end.length = 0;

			this.pendingWritePromises.length = 0;
		}
	}
}

/**
 * Helper to fully read a T readable into a T.
 */
export function consumeReadable<T>(readable: Readable<T>, reducer: IReducer<T>): T {
	const chunks: T[] = [];

	let chunk: T | null;
	while ((chunk = readable.read()) !== null) {
		chunks.push(chunk);
	}

	return reducer(chunks);
}

/**
 * Helper to read a T readable up to a maximum of chunks. If the limit is
 * reached, will return a readable instead to ensure all data can still
 * be read.
 */
export function peekReadable<T>(readable: Readable<T>, reducer: IReducer<T>, maxChunks: number): T | Readable<T> {
	const chunks: T[] = [];

	let chunk: T | null | undefined = undefined;
	while ((chunk = readable.read()) !== null && chunks.length < maxChunks) {
		chunks.push(chunk);
	}

	// If the last chunk is null, it means we reached the end of
	// the readable and return all the data at once
	if (chunk === null && chunks.length > 0) {
		return reducer(chunks);
	}

	// Otherwise, we still have a chunk, it means we reached the maxChunks
	// value and as such we return a new Readable that first returns
	// the existing read chunks and then continues with reading from
	// the underlying readable.
	return {
		read: () => {

			// First consume chunks from our array
			if (chunks.length > 0) {
				return chunks.shift()!;
			}

			// Then ensure to return our last read chunk
			if (typeof chunk !== 'undefined') {
				const lastReadChunk = chunk;

				// explicitly use undefined here to indicate that we consumed
				// the chunk, which could have either been null or valued.
				chunk = undefined;

				return lastReadChunk;
			}

			// Finally delegate back to the Readable
			return readable.read();
		}
	};
}

/**
 * Helper to fully read a T stream into a T or consuming
 * a stream fully, awaiting all the events without caring
 * about the data.
 */
export function consumeStream<T, R = T>(stream: ReadableStreamEvents<T>, reducer: IReducer<T, R>): Promise<R>;
export function consumeStream(stream: ReadableStreamEvents<unknown>): Promise<undefined>;
export function consumeStream<T, R = T>(stream: ReadableStreamEvents<T>, reducer?: IReducer<T, R>): Promise<R | undefined> {
	return new Promise((resolve, reject) => {
		const chunks: T[] = [];

		listenStream(stream, {
			onData: chunk => {
				if (reducer) {
					chunks.push(chunk);
				}
			},
			onError: error => {
				if (reducer) {
					reject(error);
				} else {
					resolve(undefined);
				}
			},
			onEnd: () => {
				if (reducer) {
					resolve(reducer(chunks));
				} else {
					resolve(undefined);
				}
			}
		});
	});
}

export interface IStreamListener<T> {

	/**
	 * The 'data' event is emitted whenever the stream is
	 * relinquishing ownership of a chunk of data to a consumer.
	 */
	onData(data: T): void;

	/**
	 * Emitted when any error occurs.
	 */
	onError(err: Error): void;

	/**
	 * The 'end' event is emitted when there is no more data
	 * to be consumed from the stream. The 'end' event will
	 * not be emitted unless the data is completely consumed.
	 */
	onEnd(): void;
}

/**
 * Helper to listen to all events of a T stream in proper order.
 */
export function listenStream<T>(stream: ReadableStreamEvents<T>, listener: IStreamListener<T>, token?: CancellationToken): void {

	stream.on('error', error => {
		if (!token?.isCancellationRequested) {
			listener.onError(error);
		}
	});

	stream.on('end', () => {
		if (!token?.isCancellationRequested) {
			listener.onEnd();
		}
	});

	// Adding the `data` listener will turn the stream
	// into flowing mode. As such it is important to
	// add this listener last (DO NOT CHANGE!)
	stream.on('data', data => {
		if (!token?.isCancellationRequested) {
			listener.onData(data);
		}
	});
}

/**
 * Helper to peek up to `maxChunks` into a stream. The return type signals if
 * the stream has ended or not. If not, caller needs to add a `data` listener
 * to continue reading.
 */
export function peekStream<T>(stream: ReadableStream<T>, maxChunks: number): Promise<ReadableBufferedStream<T>> {
	return new Promise((resolve, reject) => {
		const streamListeners = new DisposableStore();
		const buffer: T[] = [];

		// Data Listener
		const dataListener = (chunk: T) => {

			// Add to buffer
			buffer.push(chunk);

			// We reached maxChunks and thus need to return
			if (buffer.length > maxChunks) {

				// Dispose any listeners and ensure to pause the
				// stream so that it can be consumed again by caller
				streamListeners.dispose();
				stream.pause();

				return resolve({ stream, buffer, ended: false });
			}
		};

		// Error Listener
		const errorListener = (error: Error) => {
			return reject(error);
		};

		// End Listener
		const endListener = () => {
			return resolve({ stream, buffer, ended: true });
		};

		streamListeners.add(toDisposable(() => stream.removeListener('error', errorListener)));
		stream.on('error', errorListener);

		streamListeners.add(toDisposable(() => stream.removeListener('end', endListener)));
		stream.on('end', endListener);

		// Important: leave the `data` listener last because
		// this can turn the stream into flowing mode and we
		// want `error` events to be received as well.
		streamListeners.add(toDisposable(() => stream.removeListener('data', dataListener)));
		stream.on('data', dataListener);
	});
}

/**
 * Helper to create a readable stream from an existing T.
 */
export function toStream<T>(t: T, reducer: IReducer<T>): ReadableStream<T> {
	const stream = newWriteableStream<T>(reducer);

	stream.end(t);

	return stream;
}

/**
 * Helper to create an empty stream
 */
export function emptyStream(): ReadableStream<never> {
	const stream = newWriteableStream<never>(() => { throw new Error('not supported'); });
	stream.end();

	return stream;
}

/**
 * Helper to convert a T into a Readable<T>.
 */
export function toReadable<T>(t: T): Readable<T> {
	let consumed = false;

	return {
		read: () => {
			if (consumed) {
				return null;
			}

			consumed = true;

			return t;
		}
	};
}

/**
 * Helper to transform a readable stream into another stream.
 */
export function transform<Original, Transformed>(stream: ReadableStreamEvents<Original>, transformer: ITransformer<Original, Transformed>, reducer: IReducer<Transformed>): ReadableStream<Transformed> {
	const target = newWriteableStream<Transformed>(reducer);

	listenStream(stream, {
		onData: data => target.write(transformer.data(data)),
		onError: error => target.error(transformer.error ? transformer.error(error) : error),
		onEnd: () => target.end()
	});

	return target;
}

/**
 * Helper to take an existing readable that will
 * have a prefix injected to the beginning.
 */
export function prefixedReadable<T>(prefix: T, readable: Readable<T>, reducer: IReducer<T>): Readable<T> {
	let prefixHandled = false;

	return {
		read: () => {
			const chunk = readable.read();

			// Handle prefix only once
			if (!prefixHandled) {
				prefixHandled = true;

				// If we have also a read-result, make
				// sure to reduce it to a single result
				if (chunk !== null) {
					return reducer([prefix, chunk]);
				}

				// Otherwise, just return prefix directly
				return prefix;
			}

			return chunk;
		}
	};
}

/**
 * Helper to take an existing stream that will
 * have a prefix injected to the beginning.
 */
export function prefixedStream<T>(prefix: T, stream: ReadableStream<T>, reducer: IReducer<T>): ReadableStream<T> {
	let prefixHandled = false;

	const target = newWriteableStream<T>(reducer);

	listenStream(stream, {
		onData: data => {

			// Handle prefix only once
			if (!prefixHandled) {
				prefixHandled = true;

				return target.write(reducer([prefix, data]));
			}

			return target.write(data);
		},
		onError: error => target.error(error),
		onEnd: () => {

			// Handle prefix only once
			if (!prefixHandled) {
				prefixHandled = true;

				target.write(prefix);
			}

			target.end();
		}
	});

	return target;
}
