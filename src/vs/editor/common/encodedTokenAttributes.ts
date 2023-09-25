/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * [개요]
 * export const enum LanguageId
 * export const enum FontStyle
 * export const enum ColorId
 * export const enum StandardTokenType
 * export const enum MetadataConsts
[*]export class TokenMetadata
 * export interface ITokenPresentation
 *--------------------------------------------------------------------------------------------*/

/**
 * Open ended enum at runtime
 */
export const enum LanguageId {
	Null = 0,
	PlainText = 1
}

/**
 * 폰트 스타일 \
 * Values are 2^x such that a bit mask can be used.
 *
 * `NotSet` = -1, `None` = 0, `Italic` = 1, `Bold` = 2, `Underline` = 4, `Strikethrough` = 8,
 */
export const enum FontStyle {
	NotSet = -1,
	None = 0,
	Italic = 1,
	Bold = 2,
	Underline = 4,
	Strikethrough = 8,
}

/**
 * Open ended enum at runtime
 *
 * `None` = 0, `DefaultForeground` = 1, `DefaultBackground` = 2, `...`
 */
export const enum ColorId {
	None = 0,
	DefaultForeground = 1,
	DefaultBackground = 2
}

/**
 * A standard token type.
 *
 * `Other` = 0, `Comment` = 1, `String` = 2, `RegEx` = 3
 */
export const enum StandardTokenType {
	Other = 0,
	Comment = 1,
	String = 2,
	RegEx = 3
}

/**
 * Helpers to manage the "collapsed" metadata of an entire StackElement stack. \
 * The following assumptions have been made:
 *  - languageId < 256 => needs 8 bits
 *  - unique color count < 512 => needs 9 bits
 *
 * The binary format is:
 * - -------------------------------------------
 *     3322 2222 2222 1111 1111 1100 0000 0000
 *     1098 7654 3210 9876 5432 1098 7654 3210
 * - -------------------------------------------
 *     xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx
 *     bbbb bbbb ffff ffff fFFF FBTT LLLL LLLL
 * - -------------------------------------------
 *  - L = LanguageId (8 bits)
 *  - T = StandardTokenType (2 bits)
 *  - B = Balanced bracket (1 bit) - 참고: https://jackpot53.tistory.com/121
 *  - F = FontStyle (4 bits)
 *  - f = 전경색 (9 bits)
 *  - b = 배경색 (9 bits)
 *
 */
export const enum MetadataConsts {
	LANGUAGEID_MASK = 0b00000000000000000000000011111111,
	TOKEN_TYPE_MASK = 0b00000000000000000000001100000000,
	BALANCED_BRACKETS_MASK = 0b00000000000000000000010000000000,
	FONT_STYLE_MASK = 0b00000000000000000111100000000000,
	FOREGROUND_MASK = 0b00000000111111111000000000000000,
	BACKGROUND_MASK = 0b11111111000000000000000000000000,

	ITALIC_MASK = 0b00000000000000000000100000000000,
	BOLD_MASK = 0b00000000000000000001000000000000,
	UNDERLINE_MASK = 0b00000000000000000010000000000000,
	STRIKETHROUGH_MASK = 0b00000000000000000100000000000000,

	// Semantic tokens cannot set the language id, so we can
	// use the first 8 bits for control purposes
	SEMANTIC_USE_ITALIC = 0b00000000000000000000000000000001,
	SEMANTIC_USE_BOLD = 0b00000000000000000000000000000010,
	SEMANTIC_USE_UNDERLINE = 0b00000000000000000000000000000100,
	SEMANTIC_USE_STRIKETHROUGH = 0b00000000000000000000000000001000,
	SEMANTIC_USE_FOREGROUND = 0b00000000000000000000000000010000,
	SEMANTIC_USE_BACKGROUND = 0b00000000000000000000000000100000,

	LANGUAGEID_OFFSET = 0,
	TOKEN_TYPE_OFFSET = 8,
	BALANCED_BRACKETS_OFFSET = 10,
	FONT_STYLE_OFFSET = 11,
	FOREGROUND_OFFSET = 15,
	BACKGROUND_OFFSET = 24
}

/**
 */
export class TokenMetadata {

	public static getLanguageId(metadata: number): LanguageId {
		return (metadata & MetadataConsts.LANGUAGEID_MASK) >>> MetadataConsts.LANGUAGEID_OFFSET;
	}

	public static getTokenType(metadata: number): StandardTokenType {
		return (metadata & MetadataConsts.TOKEN_TYPE_MASK) >>> MetadataConsts.TOKEN_TYPE_OFFSET;
	}

	public static containsBalancedBrackets(metadata: number): boolean {
		return (metadata & MetadataConsts.BALANCED_BRACKETS_MASK) !== 0;
	}

	public static getFontStyle(metadata: number): FontStyle {
		return (metadata & MetadataConsts.FONT_STYLE_MASK) >>> MetadataConsts.FONT_STYLE_OFFSET;
	}

	public static getForeground(metadata: number): ColorId {
		return (metadata & MetadataConsts.FOREGROUND_MASK) >>> MetadataConsts.FOREGROUND_OFFSET;
	}

	public static getBackground(metadata: number): ColorId {
		return (metadata & MetadataConsts.BACKGROUND_MASK) >>> MetadataConsts.BACKGROUND_OFFSET;
	}

	/**
	 * 텍스트 스타일에 대응하는 클래스 이름 반환
	 * - 렌더링할 때 호출됨
	 */
	public static getClassNameFromMetadata(metadata: number): string {
		const foreground = this.getForeground(metadata);
		let className = 'mtk' + foreground;

		const fontStyle = this.getFontStyle(metadata);
		if (fontStyle & FontStyle.Italic) {
			className += ' mtki';
		}
		if (fontStyle & FontStyle.Bold) {
			className += ' mtkb';
		}
		if (fontStyle & FontStyle.Underline) {
			className += ' mtku';
		}
		if (fontStyle & FontStyle.Strikethrough) {
			className += ' mtks';
		}

		return className;
	}

	// 테스트용
	// static toggle = true;
	/*
	 * <span> 태그의 style 속성에 들어가는 CSS 형식 문자열 반환
	 * - 텍스트 복사할 때 호출됨
	 */
	public static getInlineStyleFromMetadata(metadata: number, colorMap: string[]): string {
		const foreground = this.getForeground(metadata);
		const fontStyle = this.getFontStyle(metadata);

		let result = `color: ${colorMap[foreground]};`;
		// 테스트용
		// if (TokenMetadata.toggle) { result = `vertical-align: sub; font-size: 9px`; }
		// if (TokenMetadata.toggle) { result = `vertical-align: super; font-size: 9px`; }
		// TokenMetadata.toggle = !TokenMetadata.toggle;

		if (fontStyle & FontStyle.Italic) {
			result += 'font-style: italic;';
		}
		if (fontStyle & FontStyle.Bold) {
			result += 'font-weight: bold;';
		}
		let textDecoration = '';
		if (fontStyle & FontStyle.Underline) {
			textDecoration += ' underline';
		}
		if (fontStyle & FontStyle.Strikethrough) {
			textDecoration += ' line-through';
		}
		if (textDecoration) {
			result += `text-decoration:${textDecoration};`;
		}
		return result;
	}

	public static getPresentationFromMetadata(metadata: number): ITokenPresentation {
		const foreground = this.getForeground(metadata);
		const fontStyle = this.getFontStyle(metadata);

		return {
			foreground: foreground,
			italic: Boolean(fontStyle & FontStyle.Italic),
			bold: Boolean(fontStyle & FontStyle.Bold),
			underline: Boolean(fontStyle & FontStyle.Underline),
			strikethrough: Boolean(fontStyle & FontStyle.Strikethrough),
		};
	}
}

/**
 */
export interface ITokenPresentation {
	foreground: ColorId;
	italic: boolean;
	bold: boolean;
	underline: boolean;
	strikethrough: boolean;
}
