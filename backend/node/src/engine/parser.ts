import ExcelJS from "exceljs";
import crypto from "crypto";
import path from "path";
import { parse } from "csv-parse/sync";

import {
    CellValue,
    ColumnInfo,
    ParsedFile,
} from "../canonical/types";

/**
 * ============================================================
 * Parser
 * ============================================================
 */

/**
 * 列名を正規化する。
 */
export function normalizeColumnName(
    value: string,
): string {
    return value
        .trim()
        .replace(/\s+/g, " ");
}

/**
 * CellValueを文字列化する。
 */
export function cellToString(
    value: unknown,
): string {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
}

/**
 * 空セル判定。
 */
export function isEmptyCell(
    value: unknown,
): boolean {
    return (
        value === null ||
        value === undefined ||
        cellToString(value).trim() === ""
    );
}

/**
 * 列のデータ型を推定する。
 */
export function inferType(
    values: CellValue[],
): ColumnInfo["type"] {
    const nonEmpty =
        values.filter(
            (value) =>
                !isEmptyCell(value),
        );

    if (nonEmpty.length === 0) {
        return "unknown";
    }

    if (
        nonEmpty.every(
            (value) =>
                value instanceof Date,
        )
    ) {
        return "date";
    }

    if (
        nonEmpty.every(
            (value) =>
                typeof value === "number",
        )
    ) {
        return "number";
    }

    if (
        nonEmpty.every(
            (value) =>
                typeof value === "boolean",
        )
    ) {
        return "boolean";
    }

    return "string";
}

/**
 * ============================================================
 * CSV
 * ============================================================
 */

function decodeCsv(
    buffer: Buffer,
): string {
    /**
     * UTF-8 BOM
     */
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf
    ) {
        return buffer
            .subarray(3)
            .toString("utf8");
    }

    const utf8 =
        buffer.toString("utf8");

    const replacementCount =
        (
            utf8.match(/\ufffd/g) ||
            []
        ).length;

    /**
     * UTF-8として壊れている場合は
     * CP932を試す。
     */
    if (replacementCount > 0) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const iconv =
                require("iconv-lite");

            if (
                iconv.encodingExists(
                    "cp932",
                )
            ) {
                return iconv.decode(
                    buffer,
                    "cp932",
                );
            }
        } catch {
            // UTF-8 fallback
        }
    }

    return utf8;
}

export function parseCsv(
    buffer: Buffer,
    filename: string,
): ParsedFile {
    const text =
        decodeCsv(buffer);

    let records:
        Record<string, string>[];

    try {
        records =
            parse(text, {
                columns: true,
                skip_empty_lines: true,
                bom: true,
                relax_column_count: true,
                trim: true,
            }) as Record<
                string,
                string
            >[];
    } catch (error) {
        console.error(
            "[CSV] parse error:",
            error,
        );

        throw new Error(
            `${filename}: CSVの解析に失敗しました。`,
        );
    }

    if (records.length === 0) {
        throw new Error(
            `${filename}: CSVにデータがありません。`,
        );
    }

    const originalHeaders =
        Object.keys(records[0]);

    const headers =
        originalHeaders.map(
            normalizeColumnName,
        );

    const rows:
        Record<string, CellValue>[] =
        records.map(
            (record) => {
                const result:
                    Record<
                        string,
                        CellValue
                    > = {};

                originalHeaders.forEach(
                    (
                        originalHeader,
                        index,
                    ) => {
                        result[
                            headers[index]
                        ] =
                            record[
                            originalHeader
                            ] ?? "";
                    },
                );

                return result;
            },
        );

    const columns:
        ColumnInfo[] =
        headers.map(
            (header) => {
                const values =
                    rows.map(
                        (row) =>
                            row[header],
                    );

                return {
                    name: header,

                    type:
                        inferType(
                            values,
                        ),

                    samples:
                        values
                            .filter(
                                (
                                    value,
                                ) =>
                                    !isEmptyCell(
                                        value,
                                    ),
                            )
                            .slice(0, 10)
                            .map(
                                cellToString,
                            ),
                };
            },
        );

    console.log(
        `[CSV] Parsed: ${filename}`,
    );

    console.log(
        "[CSV] Columns:",
        columns,
    );

    return {
        id:
            crypto.randomUUID(),

        filename,

        type: "csv",

        sheetName: "CSV",

        columns,

        rows,
    };
}

/**
 * ============================================================
 * XLSX
 * ============================================================
 */

export async function parseXlsx(
    buffer: Buffer,
    filename: string,
): Promise<ParsedFile> {
    const workbook =
        new ExcelJS.Workbook();

    await workbook.xlsx.load(
        buffer as any,
    );

    const worksheet =
        workbook.worksheets[0];

    if (!worksheet) {
        throw new Error(
            `${filename}: ワークシートがありません。`,
        );
    }

    /**
     * ========================================================
     * Header row detection
     * ========================================================
     */

    let headerRowNumber = 0;

    for (
        let rowNumber = 1;
        rowNumber <=
        worksheet.rowCount;
        rowNumber++
    ) {
        const row =
            worksheet.getRow(
                rowNumber,
            );

        let nonEmptyCount = 0;

        for (
            let columnNumber = 1;
            columnNumber <=
            worksheet.columnCount;
            columnNumber++
        ) {
            const value =
                row
                    .getCell(
                        columnNumber,
                    )
                    .value;

            if (!isEmptyCell(value)) {
                nonEmptyCount++;
            }
        }

        if (nonEmptyCount >= 2) {
            headerRowNumber =
                rowNumber;

            break;
        }
    }

    if (headerRowNumber === 0) {
        throw new Error(
            `${filename}: Excelのヘッダー行を検出できませんでした。`,
        );
    }

    console.log(
        `[XLSX] Header row: ${headerRowNumber}`,
    );

    /**
     * ========================================================
     * Header
     * ========================================================
     */

    const headerRow =
        worksheet.getRow(
            headerRowNumber,
        );

    const headers: string[] = [];

    const columnCount =
        Math.max(
            worksheet.actualColumnCount,
            worksheet.columnCount,
        );

    for (
        let columnNumber = 1;
        columnNumber <=
        columnCount;
        columnNumber++
    ) {
        const cell =
            headerRow.getCell(
                columnNumber,
            );

        let header =
            cellToString(
                cell.value,
            ).trim();

        if (!header) {
            header =
                `Column${columnNumber}`;
        }

        headers.push(
            normalizeColumnName(
                header,
            ),
        );
    }

    /**
     * ========================================================
     * Data rows
     * ========================================================
     */

    const rows:
        Record<string, CellValue>[] =
        [];

    for (
        let rowNumber =
            headerRowNumber + 1;
        rowNumber <=
        worksheet.rowCount;
        rowNumber++
    ) {
        const row =
            worksheet.getRow(
                rowNumber,
            );

        const result:
            Record<
                string,
                CellValue
            > = {};

        let hasValue = false;

        for (
            let columnNumber = 1;
            columnNumber <=
            headers.length;
            columnNumber++
        ) {
            const header =
                headers[
                columnNumber - 1
                ];

            const value =
                row
                    .getCell(
                        columnNumber,
                    )
                    .value as CellValue;

            if (!isEmptyCell(value)) {
                hasValue = true;
            }

            result[header] =
                value ?? "";
        }

        if (hasValue) {
            rows.push(result);
        }
    }

    /**
     * ========================================================
     * Column information
     * ========================================================
     */

    const columns:
        ColumnInfo[] =
        headers.map(
            (header) => {
                const values =
                    rows.map(
                        (row) =>
                            row[header],
                    );

                return {
                    name: header,

                    type:
                        inferType(
                            values,
                        ),

                    samples:
                        values
                            .filter(
                                (
                                    value,
                                ) =>
                                    !isEmptyCell(
                                        value,
                                    ),
                            )
                            .slice(0, 10)
                            .map(
                                cellToString,
                            ),
                };
            },
        );

    console.log(
        `[XLSX] Parsed: ${filename}`,
    );

    console.log(
        `[XLSX] Sheet: ${worksheet.name}`,
    );

    console.log(
        `[XLSX] Data rows: ${rows.length}`,
    );

    return {
        id:
            crypto.randomUUID(),

        filename,

        type: "xlsx",

        sheetName:
            worksheet.name,

        columns,

        rows,
    };
}

/**
 * ============================================================
 * Public parser
 * ============================================================
 */

function isExcel(
    filename: string,
): boolean {
    return (
        path
            .extname(filename)
            .toLowerCase() ===
        ".xlsx"
    );
}

function isCsv(
    filename: string,
): boolean {
    return (
        path
            .extname(filename)
            .toLowerCase() ===
        ".csv"
    );
}

export async function parseInputFile(
    file: Express.Multer.File,
): Promise<ParsedFile> {
    if (
        isExcel(
            file.originalname,
        )
    ) {
        return parseXlsx(
            file.buffer,
            file.originalname,
        );
    }

    if (
        isCsv(
            file.originalname,
        )
    ) {
        return parseCsv(
            file.buffer,
            file.originalname,
        );
    }

    throw new Error(
        `${file.originalname}: .xlsx または .csv のみ対応しています。`,
    );
}
