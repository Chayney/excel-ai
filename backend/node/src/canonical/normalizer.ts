import {
    CanonicalColumn,
    CellValue,
    NormalizedRow,
} from "./types";
import { CANONICAL_SCHEMA } from "./schema";

/**
 * ============================================================
 * String
 * ============================================================
 */

function normalizeString(value: CellValue): string {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .trim()
        .replace(/\u3000/g, " ")
        .replace(/\s+/g, " ");
}

/**
 * ============================================================
 * Store ID
 * ============================================================
 */

function normalizeStoreId(value: CellValue): string {
    if (value === null || value === undefined) {
        return "";
    }

    let result = String(value).trim();

    result = result.replace(/^店舗コード[:：]?\s*/i, "");
    result = result.replace(/^店舗ID[:：]?\s*/i, "");

    return result.trim();
}

/**
 * ============================================================
 * Number
 * ============================================================
 *
 * 対応例:
 *
 * 1000
 * "1000"
 * "1,000"
 * "¥1,000"
 * "1,000円"
 * "(1,000)"
 * "-1,000"
 *
 * -> 1000
 * -> -1000
 */

function normalizeNumber(value: CellValue): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "number") {
        if (Number.isFinite(value)) {
            return value;
        }

        return null;
    }

    if (value instanceof Date) {
        return null;
    }

    let text = String(value).trim();

    if (!text) {
        return null;
    }

    let negative = false;

    if (/^\(.*\)$/.test(text)) {
        negative = true;
        text = text.slice(1, -1);
    }

    text = text
        .replace(/[¥￥$€£]/g, "")
        .replace(/円/g, "")
        .replace(/,/g, "")
        .replace(/_/g, "")
        .trim();

    if (!text) {
        return null;
    }

    const number = Number(text);

    if (!Number.isFinite(number)) {
        return null;
    }

    return negative ? -number : number;
}

/**
 * ============================================================
 * Date
 * ============================================================
 */

function normalizeDate(value: CellValue): Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            return null;
        }

        return new Date(value.getTime());
    }

    if (typeof value === "number") {
        /**
         * Excel serial date
         *
         * ExcelJSからnumberとして来るケースへの対応。
         */
        const excelEpoch = new Date(
            Date.UTC(1899, 11, 30),
        );

        const date = new Date(
            excelEpoch.getTime() +
            value * 24 * 60 * 60 * 1000,
        );

        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return date;
    }

    let text = String(value).trim();

    if (!text) {
        return null;
    }

    /**
     * YYYY年MM月DD日
     */
    text = text.replace(/年/g, "-");
    text = text.replace(/月/g, "-");
    text = text.replace(/日/g, "");

    /**
     * YYYY/MM/DD
     * YYYY.MM.DD
     */
    text = text.replace(/[./]/g, "-");

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

/**
 * ============================================================
 * Boolean
 * ============================================================
 */

function normalizeBoolean(value: CellValue): boolean | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "boolean") {
        return value;
    }

    const text = String(value).trim().toLowerCase();

    if (
        [
            "true",
            "1",
            "yes",
            "y",
            "○",
            "〇",
            "はい",
            "有",
        ].includes(text)
    ) {
        return true;
    }

    if (
        [
            "false",
            "0",
            "no",
            "n",
            "×",
            "x",
            "いいえ",
            "無",
        ].includes(text)
    ) {
        return false;
    }

    return null;
}

/**
 * ============================================================
 * Normalize single value
 * ============================================================
 */

export const normalizeValue = (
    value: CellValue,
    column: CanonicalColumn,
): CellValue => {
    switch (column.normalizer) {
        case "string":
            return normalizeString(value);

        case "trim":
            return normalizeString(value);

        case "store_id":
            return normalizeStoreId(value);

        case "number":
            return normalizeNumber(value);

        case "date":
            return normalizeDate(value);

        case "boolean":
            return normalizeBoolean(value);

        default:
            return value;
    }
};


/**
 * ============================================================
 * Normalize row
 * ============================================================
 *
 * source row
 *
 * {
 *   sale: "¥1,000",
 *   store: "001",
 *   date: "2026/09/13"
 * }
 *
 * ↓
 *
 * {
 *   sales_amount: 1000,
 *   store_id: "001",
 *   sales_date: Date
 * }
 */

export const normalizeRow = (
    row: Record<string, CellValue>,
    mappings: {
        sourceColumn: string;
        canonicalKey: string;
    }[],
): NormalizedRow => {
    const result: NormalizedRow = {};

    for (const mapping of mappings) {
        const canonical = CANONICAL_SCHEMA.columns.find(
            (column) => column.key === mapping.canonicalKey,
        );

        if (!canonical) {
            continue;
        }

        const value = row[mapping.sourceColumn];

        result[canonical.key] = normalizeValue(
            value,
            canonical,
        );
    }

    return result;
};


/**
 * ============================================================
 * Normalize complete file
 * ============================================================
 */

export const normalizeRows = (
    rows: Record<string, CellValue>[],
    mappings: {
        sourceColumn: string;
        canonicalKey: string;
    }[],
): NormalizedRow[] => {
    return rows.map((row) => normalizeRow(row, mappings));
};
