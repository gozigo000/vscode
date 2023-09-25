/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * [개요]
 * export const enum `CursorChangeReason`
 * export interface `ICursorPositionChangedEvent`
 * export interface `ICursorSelectionChangedEvent`
 *--------------------------------------------------------------------------------------------*/

import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';

/**
 * 커서가 위치를 바꾼 이유s
 */
export const enum CursorChangeReason {
	/**
	 * Unknown or not set.
	 */
	NotSet = 0,
	/**
	 * `model.setValue()`가 호출되었음
	 */
	ContentFlush = 1,
	/**
	 * The `model` has been changed outside of this cursor and the cursor recovers its position from associated markers.
	 */
	RecoverFromMarkers = 2,
	/**
	 * There was an explicit user gesture.
	 */
	Explicit = 3,
	/**
	 * 붙여넣기(Paste) 했음
	 */
	Paste = 4,
	/**
	 * 뒤로 가기(Undo) 했음
	 */
	Undo = 5,
	/**
	 * 앞으로 가기(Redo) 했음
	 */
	Redo = 6,
}
/**
 * An event - 커서 위치(position)가 바뀜
 *
 * -`position` \
 * -`secondaryPositions`
 *
 * -`source` \
 * -`reason`
 */
export interface ICursorPositionChangedEvent {
	/**
	 * Primary cursor's position.
	 */
	readonly position: Position;
	/**
	 * Secondary cursors' position.
	 */
	readonly secondaryPositions: Position[];
	/**
	 * Reason.
	 */
	readonly reason: CursorChangeReason;
	/**
	 * Source of the call that caused the event.
	 */
	readonly source: string;
}
/**
 * An event - 커서 선택범위(selection)가 바뀜
 *
 * -`selection` \
 * -`secondarySelections` \
 * -`modelVersionId`
 *
 * -`oldSelections` \
 * -`oldModelVersionId`
 *
 * -`source` \
 * -`reason`
 */
export interface ICursorSelectionChangedEvent {
	/**
	 * The primary selection.
	 */
	readonly selection: Selection;
	/**
	 * The secondary selections.
	 */
	readonly secondarySelections: Selection[];
	/**
	 * The model version id.
	 */
	readonly modelVersionId: number;
	/**
	 * The old selections.
	 */
	readonly oldSelections: Selection[] | null;
	/**
	 * The model version id the that `oldSelections` refer to.
	 */
	readonly oldModelVersionId: number;
	/**
	 * Source of the call that caused the event.
	 */
	readonly source: string;
	/**
	 * Reason.
	 */
	readonly reason: CursorChangeReason;
}
