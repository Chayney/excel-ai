import express from "express";
import multer from "multer";
import cors from "cors";
import ExcelJS from "exceljs";
import crypto from "crypto";
import path from "path";
import { parse } from "csv-parse/sync";

import { AIProvider } from "./ai/aiProvider";
import { createAIProvider } from "./ai/createaiProvider";

// ============================================================
// Types
// ============================================================

type CellValue =
    | string
    | number
    | boolean
    | Date
    | null
    | undefined;

type ColumnInfo = {
    name: string;
    type: string;
    samples: string[];
};

type FileInfo = {
    id: string;
    filename: string;

    type:
    | "csv"
    | "xlsx";

    sheetName: string;

    columns: ColumnInfo[];

    rows: Record<
        string,
        CellValue
    >[];
};

type MappingSuggestion = {
    id: string;

    sourceFile: string;

    sourceColumn: string;

    candidateColumn: string;

    confidence: number;

    reason: string;
};

type MappingDecision =
    | "target"
    | "source"
    | "reject";

type ConfirmedMapping = {
    sourceFile: string;

    sourceColumn: string;

    targetColumn: string;

    decision: MappingDecision;

    outputColumn: string;
};

type AnalyzeResponse = {
    files: {
        filename: string;

        sheetName: string;

        columns: ColumnInfo[];

        rowCount: number;
    }[];

    target: {
        filename: string;

        sheetName: string;

        columns: ColumnInfo[];
    };

    suggestions: MappingSuggestion[];

    automaticMappings: ConfirmedMapping[];

    unmatchedSourceColumns: string[];

    unmatchedTargetColumns: string[];
};

// ============================================================
// Express
// ============================================================

const app =
    express();

app.use(
    cors({
        origin: true,
    }),
);

app.use(
    express.json(),
);

const upload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                50 * 1024 * 1024,
        },
    });

// ============================================================
// AI Provider
// ============================================================

let aiProvider: AIProvider;

try {
    aiProvider =
        createAIProvider();

    console.log(
        "========================================",
    );

    console.log(
        "[AI] Provider initialized",
    );

    console.log(
        "[AI] Provider:",
        process.env.AI_PROVIDER ||
        "ollama",
    );

    console.log(
        "[AI] Model:",
        process.env.OLLAMA_MODEL ||
        "qwen3:8b",
    );

    console.log(
        "========================================",
    );
} catch (error) {
    console.error(
        "[AI] Failed to initialize AI provider:",
        error,
    );

    process.exit(1);
}

// ============================================================
// Utility
// ============================================================

function normalizeColumnName(
    value: string,
): string {
    return value
        .trim()
        .replace(/\s+/g, " ");
}

function cellToString(
    value: unknown,
): string {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        typeof value === "object"
    ) {
        try {
            return JSON.stringify(
                value,
            );
        } catch {
            return String(value);
        }
    }

    return String(value);
}

function isEmptyCell(
    value: unknown,
): boolean {
    return (
        value === null ||
        value === undefined ||
        cellToString(value).trim() === ""
    );
}

function inferType(
    values: CellValue[],
): string {
    const nonEmpty =
        values.filter(
            (value) =>
                !isEmptyCell(value),
        );

    if (
        nonEmpty.length === 0
    ) {
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
                typeof value ===
                "number",
        )
    ) {
        return "number";
    }

    if (
        nonEmpty.every(
            (value) =>
                typeof value ===
                "boolean",
        )
    ) {
        return "boolean";
    }

    return "string";
}

function normalizeForComparison(
    value: string,
): string {
    return value
        .trim()
        .toLowerCase()
        .replace(
            /[\s_\-./]/g,
            "",
        );
}

function cloneValue(
    value: CellValue,
): CellValue {
    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime(),
        );
    }

    return value;
}

function getUniqueColumnName(
    existing: Set<string>,
    desired: string,
): string {
    const base =
        desired.trim() ||
        "Column";

    if (
        !existing.has(base)
    ) {
        return base;
    }

    let index = 2;

    while (
        existing.has(
            `${base}_${index}`,
        )
    ) {
        index++;
    }

    return `${base}_${index}`;
}

// ============================================================
// Safe row value getter
// ============================================================

function getValueByColumn(
    row: Record<
        string,
        CellValue
    >,
    columnName: string,
): CellValue {
    return row[columnName];
}

// ============================================================
// CSV
// ============================================================

function decodeCsv(
    buffer: Buffer,
): string {
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

    if (
        replacementCount > 0
    ) {
        try {
            const iconv =
                require(
                    "iconv-lite",
                );

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

function parseCsv(
    buffer: Buffer,
    filename: string,
): FileInfo {
    const text =
        decodeCsv(buffer);

    let records:
        Record<
            string,
            string
        >[];

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

    if (
        records.length === 0
    ) {
        throw new Error(
            `${filename}: CSVにデータがありません。`,
        );
    }

    const originalHeaders =
        Object.keys(
            records[0],
        );

    const headers =
        originalHeaders.map(
            normalizeColumnName,
        );

    const rows:
        Record<
            string,
            CellValue
        >[] =
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

// ============================================================
// XLSX
// ============================================================

async function parseXlsx(
    buffer: Buffer,
    filename: string,
): Promise<FileInfo> {
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

    // ========================================================
    // Header row detection
    // ========================================================

    let headerRowNumber =
        0;

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

        let nonEmptyCount =
            0;

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

            if (
                !isEmptyCell(value)
            ) {
                nonEmptyCount++;
            }
        }

        if (
            nonEmptyCount >= 2
        ) {
            headerRowNumber =
                rowNumber;

            break;
        }
    }

    if (
        headerRowNumber === 0
    ) {
        throw new Error(
            `${filename}: Excelのヘッダー行を検出できませんでした。`,
        );
    }

    console.log(
        `[XLSX] Header row: ${headerRowNumber}`,
    );

    // ========================================================
    // Header cells
    // ========================================================

    const headerRow =
        worksheet.getRow(
            headerRowNumber,
        );

    const headers:
        string[] = [];

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

        const rawValue =
            cell.value;

        let header =
            cellToString(
                rawValue,
            ).trim();

        if (!header) {
            header =
                `Column${columnNumber}`;
        }

        header =
            normalizeColumnName(
                header,
            );

        headers.push(
            header,
        );
    }

    // ========================================================
    // Data rows
    // ========================================================

    const rows:
        Record<
            string,
            CellValue
        >[] = [];

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

        let hasValue =
            false;

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

            if (
                !isEmptyCell(value)
            ) {
                hasValue =
                    true;
            }

            result[header] =
                value ?? "";
        }

        if (hasValue) {
            rows.push(
                result,
            );
        }
    }

    // ========================================================
    // Column information
    // ========================================================

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

    console.log(
        "[XLSX] Columns:",
        columns,
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

// ============================================================
// File parser
// ============================================================

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

async function parseInputFile(
    file: Express.Multer.File,
): Promise<FileInfo> {
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

// ============================================================
// AI response parser
// ============================================================

function parseSuggestionResponse(
    content: string,
): MappingSuggestion[] {
    try {
        let cleaned =
            content.trim();

        cleaned =
            cleaned.replace(
                /^```json\s*/i,
                "",
            );

        cleaned =
            cleaned.replace(
                /^```\s*/i,
                "",
            );

        cleaned =
            cleaned.replace(
                /\s*```$/i,
                "",
            );

        cleaned =
            cleaned.trim();

        if (!cleaned) {
            return [];
        }

        const parsed:
            unknown =
            JSON.parse(
                cleaned,
            );

        let rawSuggestions:
            unknown[] = [];

        if (
            Array.isArray(
                parsed,
            )
        ) {
            rawSuggestions =
                parsed;
        } else if (
            parsed !== null &&
            typeof parsed ===
            "object"
        ) {
            const object =
                parsed as Record<
                    string,
                    unknown
                >;

            if (
                Array.isArray(
                    object.suggestions,
                )
            ) {
                rawSuggestions =
                    object.suggestions;
            }
        }

        const suggestions:
            MappingSuggestion[] =
            [];

        for (
            const item of
            rawSuggestions
        ) {
            if (
                item === null ||
                typeof item !==
                "object"
            ) {
                continue;
            }

            const raw =
                item as Record<
                    string,
                    unknown
                >;

            const sourceFile =
                typeof raw.sourceFile ===
                    "string"
                    ? raw.sourceFile.trim()
                    : "";

            const sourceColumn =
                typeof raw.sourceColumn ===
                    "string"
                    ? raw.sourceColumn.trim()
                    : "";

            const candidateColumn =
                typeof raw.candidateColumn ===
                    "string"
                    ? raw.candidateColumn.trim()
                    : "";

            if (
                !sourceFile ||
                !sourceColumn ||
                !candidateColumn
            ) {
                continue;
            }

            let confidence =
                typeof raw.confidence ===
                    "number"
                    ? raw.confidence
                    : 0.8;

            if (
                !Number.isFinite(
                    confidence,
                )
            ) {
                confidence =
                    0.8;
            }

            confidence =
                Math.max(
                    0,
                    Math.min(
                        1,
                        confidence,
                    ),
                );

            const reason =
                typeof raw.reason ===
                    "string" &&
                    raw.reason.trim()
                    ? raw.reason.trim()
                    : "AIによる列マッピング候補";

            suggestions.push({
                id:
                    crypto.randomUUID(),

                sourceFile,

                sourceColumn,

                candidateColumn,

                confidence,

                reason,
            });
        }

        return suggestions;
    } catch (error) {
        console.error(
            "[AI] Failed to parse suggestion response:",
            error,
        );

        return [];
    }
}

// ============================================================
// AI Mapping
// ============================================================

async function createMappingSuggestions(
    sourceFiles: FileInfo[],
    targetColumns: ColumnInfo[],
    organizationKey: string,
    ai: AIProvider,
): Promise<{
    suggestions: MappingSuggestion[];

    automaticMappings:
    ConfirmedMapping[];
}> {
    const automaticMappings:
        ConfirmedMapping[] =
        [];

    const suggestions:
        MappingSuggestion[] =
        [];

    const targetNames =
        targetColumns.map(
            (column) =>
                column.name,
        );

    const aiCandidates:
        {
            sourceFile: string;

            column: ColumnInfo;
        }[] = [];

    for (
        const file of
        sourceFiles
    ) {
        for (
            const column of
            file.columns
        ) {
            const sourceName =
                normalizeColumnName(
                    column.name,
                );

            // ----------------------------------------------------
            // 完全一致
            // ----------------------------------------------------

            let target =
                targetNames.find(
                    (name) =>
                        name ===
                        sourceName,
                );

            if (target) {
                automaticMappings.push({
                    sourceFile:
                        file.filename,

                    sourceColumn:
                        column.name,

                    targetColumn:
                        target,

                    decision:
                        "target",

                    outputColumn:
                        target,
                });

                continue;
            }

            // ----------------------------------------------------
            // 正規化一致
            // ----------------------------------------------------

            const normalizedSource =
                normalizeForComparison(
                    sourceName,
                );

            target =
                targetNames.find(
                    (name) =>
                        normalizeForComparison(
                            name,
                        ) ===
                        normalizedSource,
                );

            if (target) {
                automaticMappings.push({
                    sourceFile:
                        file.filename,

                    sourceColumn:
                        column.name,

                    targetColumn:
                        target,

                    decision:
                        "target",

                    outputColumn:
                        target,
                });

                continue;
            }

            // ----------------------------------------------------
            // AI候補
            // ----------------------------------------------------

            aiCandidates.push({
                sourceFile:
                    file.filename,

                column,
            });
        }
    }

    if (
        aiCandidates.length ===
        0
    ) {
        return {
            suggestions,

            automaticMappings,
        };
    }

    const prompt = `
あなたはExcel/CSVデータ統合の専門家です。

入力ファイルの列と統合先ファイルの列を比較してください。

判定単位は「列」です。

# 組織識別情報

${organizationKey || "(指定なし)"}

# 入力側

${JSON.stringify(
        aiCandidates,
        null,
        2,
    )}

# 統合先

${JSON.stringify(
        targetColumns,
        null,
        2,
    )}

# ルール

- 列名、データ型、サンプル値を比較してください。
- 同じ意味の列だけ候補にしてください。
- 「売上」と「売上高」は同じ意味として扱って構いません。
- 「sale」「sales」「revenue」「売上」「売上高」は、売上金額を表している場合は同じ意味として扱って構いません。
- 日本語と英語でも意味が同じなら候補にしてください。
- company_id と companyId のような表記揺れも同じ意味として扱ってください。
- 「利益」と「営業利益」は別です。
- 「粗利益」と「営業利益」も別です。
- confidenceが0.70未満の候補は返さないでください。
- candidateColumnは統合先に実在する列名だけにしてください。
- JSONのみ返してください。

重要:

例えば、

入力側:
{
  "sourceColumn": "sale"
}

統合先:
{
  "name": "売上高"
}

が同じ意味の場合、

{
  "sourceColumn": "sale",
  "candidateColumn": "売上高",
  "confidence": 0.96,
  "reason": "saleと売上高は売上金額を表すため同じ意味です。"
}

を返してください。

ただし、transform処理では、

sourceColumn = sale
targetColumn = 売上高

の場合、

decision = "target" なら出力列名を「売上高」

decision = "source" なら出力列名を「sale」

とします。

どちらの場合も新しい列は作らず、
売上高とsaleを同じ1つの列として扱います。

{
  "suggestions": [
    {
      "sourceFile": "testdata2.xlsx",
            "sourceColumn": "sale",
      "candidateColumn": "売上高",
      "confidence": 0.96,
      "reason": "saleと売上高は売上金額を表すため同じ意味です。"
    }
  ]
}
`;

    const response =
        await ai.chat([
            {
                role: "system",

                content:
                    "あなたはデータ統合候補を分析するAIです。必ずJSONのみを返してください。",
            },

            {
                role: "user",

                content:
                    prompt,
            },
        ]);

    const parsed =
        parseSuggestionResponse(
            response.content,
        );

    for (
        const suggestion of
        parsed
    ) {
        const sourceExists =
            aiCandidates.some(
                (source) =>
                    source.sourceFile ===
                        suggestion.sourceFile &&
                    source.column.name ===
                        suggestion.sourceColumn,
            );

        if (
            !sourceExists
        ) {
            continue;
        }

        const targetExists =
            targetColumns.some(
                (
                    targetColumn,
                ) =>
                    targetColumn.name ===
                    suggestion.candidateColumn,
            );

        if (
            !targetExists
        ) {
            continue;
        }

        if (
            suggestion.confidence <
            0.7
        ) {
            continue;
        }

        suggestions.push({
            ...suggestion,

            id:
                crypto.randomUUID(),
        });
    }

    suggestions.sort(
        (a, b) =>
            b.confidence -
            a.confidence,
    );

    return {
        suggestions,

        automaticMappings,
    };
}

// ============================================================
// Confirmed mapping parser
// ============================================================

function parseConfirmedMappings(
    value: unknown,
): ConfirmedMapping[] {
    if (
        typeof value !==
            "string" ||
        value.trim() ===
            ""
    ) {
        return [];
    }

    try {
        const parsed:
            unknown =
            JSON.parse(value);

        if (
            !Array.isArray(
                parsed,
            )
        ) {
            return [];
        }

        const result:
            ConfirmedMapping[] =
            [];

        for (
            const item of
            parsed
        ) {
            if (
                !item ||
                typeof item !==
                    "object"
            ) {
                continue;
            }

            const raw =
                item as Record<
                    string,
                    unknown
                >;

            if (
                typeof raw.sourceFile !==
                    "string" ||
                typeof raw.sourceColumn !==
                    "string" ||
                typeof raw.targetColumn !==
                    "string"
            ) {
                continue;
            }

            const decision =
                raw.decision ===
                    "source" ||
                raw.decision ===
                    "reject"
                    ? raw.decision
                    : "target";

            /*
             * outputColumnはクライアントから来ても
             * そのまま信用しない。
             *
             * target:
             *   targetColumn
             *
             * source:
             *   sourceColumn
             *
             * としてサーバー側で決定する。
             */
            const outputColumn =
                decision === "source"
                    ? raw.sourceColumn
                    : raw.targetColumn;

            result.push({
                sourceFile:
                    raw.sourceFile,

                sourceColumn:
                    raw.sourceColumn,

                targetColumn:
                    raw.targetColumn,

                decision,

                outputColumn,
            });
        }

        return result;
    } catch (error) {
        console.error(
            "[MAPPING] Failed to parse confirmed mappings:",
            error,
        );

        return [];
    }
}

// ============================================================
// /api/analyze
// ============================================================

app.post(
    "/api/analyze",
    upload.array("files"),
    async (req, res) => {
        try {
            const files =
                req.files as
                    | Express.Multer.File[]
                    | undefined;

            if (
                !files ||
                files.length < 2
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "統合には2ファイル以上必要です。",
                    });
            }

            const organizationKey =
                typeof req.body
                    ?.organizationKey ===
                    "string"
                    ? req.body.organizationKey
                    : "";

            const parsedFiles =
                await Promise.all(
                    files.map(
                        (file) =>
                            parseInputFile(
                                file,
                            ),
                    ),
                );

            /*
             * 先頭ファイルを統合先にする
             */
            const targetFilename =
                files[0]
                    .originalname;

            const targetFile =
                parsedFiles.find(
                    (file) =>
                        file.filename ===
                        targetFilename,
                );

            if (!targetFile) {
                return res
                    .status(400)
                    .json({
                        error:
                            `統合先ファイルが見つかりません: ${targetFilename}`,
                    });
            }

            const sourceFiles =
                parsedFiles.filter(
                    (file) =>
                        file.id !==
                        targetFile.id,
                );

            const mapping =
                await createMappingSuggestions(
                    sourceFiles,

                    targetFile.columns,

                    organizationKey,

                    aiProvider,
                );

            const mappedSourceColumns =
                new Set<string>();

            for (
                const mappingItem of
                mapping.automaticMappings
            ) {
                mappedSourceColumns.add(
                    `${mappingItem.sourceFile}:${mappingItem.sourceColumn}`,
                );
            }

            for (
                const suggestion of
                mapping.suggestions
            ) {
                mappedSourceColumns.add(
                    `${suggestion.sourceFile}:${suggestion.sourceColumn}`,
                );
            }

            const unmatchedSourceColumns =
                sourceFiles.flatMap(
                    (file) =>
                        file.columns
                            .filter(
                                (
                                    column,
                                ) =>
                                    !mappedSourceColumns.has(
                                        `${file.filename}:${column.name}`,
                                    ),
                            )
                            .map(
                                (
                                    column,
                                ) =>
                                    `${file.filename}:${column.name}`,
                            ),
                );

            const mappedTargetColumns =
                new Set<string>();

            for (
                const mappingItem of
                mapping.automaticMappings
            ) {
                mappedTargetColumns.add(
                    mappingItem.targetColumn,
                );
            }

            for (
                const suggestion of
                mapping.suggestions
            ) {
                mappedTargetColumns.add(
                    suggestion.candidateColumn,
                );
            }

            const unmatchedTargetColumns =
                targetFile.columns
                    .filter(
                        (
                            column,
                        ) =>
                            !mappedTargetColumns.has(
                                column.name,
                            ),
                    )
                    .map(
                        (
                            column,
                        ) =>
                            column.name,
                    );

            const response:
                AnalyzeResponse = {
                files:
                    parsedFiles.map(
                        (file) => ({
                            filename:
                                file.filename,

                            sheetName:
                                file.sheetName,

                            columns:
                                file.columns,

                            rowCount:
                                file.rows.length,
                        }),
                    ),

                target: {
                    filename:
                        targetFile.filename,

                    sheetName:
                        targetFile.sheetName,

                    columns:
                        targetFile.columns,
                },

                suggestions:
                    mapping.suggestions,

                automaticMappings:
                    mapping.automaticMappings,

                unmatchedSourceColumns,

                unmatchedTargetColumns,
            };

            return res.json(
                response,
            );
        } catch (error) {
            console.error(
                "[API] /api/analyze ERROR:",
                error,
            );

            return res
                .status(500)
                .json({
                    error:
                        error instanceof Error
                            ? error.message
                            : "AI解析に失敗しました。",
                });
        }
    },
);

// ============================================================
// /api/transform
// ============================================================

app.post(
    "/api/transform",
    upload.array("files"),
    async (req, res) => {
        try {
            console.log(
                "========================================",
            );

            console.log(
                "[API] /api/transform START",
            );

            const files =
                req.files as
                    | Express.Multer.File[]
                    | undefined;

            if (
                !files ||
                files.length < 2
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "統合には2ファイル以上必要です。",
                    });
            }

            const organizationKey =
                typeof req.body
                    ?.organizationKey ===
                    "string"
                    ? req.body.organizationKey
                    : "";

            // ====================================================
            // Parse
            // ====================================================

            const parsedFiles =
                await Promise.all(
                    files.map(
                        (file) =>
                            parseInputFile(
                                file,
                            ),
                    ),
                );

            // ====================================================
            // Target
            // ====================================================

            const targetFilename =
                files[0]
                    .originalname;

            const targetFile =
                parsedFiles.find(
                    (file) =>
                        file.filename ===
                        targetFilename,
                );

            if (!targetFile) {
                return res
                    .status(400)
                    .json({
                        error:
                            `統合先ファイルが見つかりません: ${targetFilename}`,
                    });
            }

            // ====================================================
            // Source
            // ====================================================

            const sourceFiles =
                parsedFiles.filter(
                    (file) =>
                        file.id !==
                        targetFile.id,
                );

            console.log(
                "[TRANSFORM] Target:",
                targetFile.filename,
            );

            console.log(
                "[TRANSFORM] Sources:",
                sourceFiles.map(
                    (file) =>
                        file.filename,
                ),
            );

            // ====================================================
            // Confirmed mappings
            // ====================================================

            const confirmedMappings =
                parseConfirmedMappings(
                    req.body
                        ?.confirmedMappings,
                );

            console.log(
                "[MAPPING] Confirmed mappings:",
                JSON.stringify(
                    confirmedMappings,
                    null,
                    2,
                ),
            );

            // ====================================================
            // Mapping
            // ====================================================

            let mappings:
                ConfirmedMapping[] =
                confirmedMappings;

            if (
                mappings.length === 0
            ) {
                const automaticResult =
                    await createMappingSuggestions(
                        sourceFiles,

                        targetFile.columns,

                        organizationKey,

                        aiProvider,
                    );

                mappings =
                    automaticResult
                        .automaticMappings;

                console.log(
                    "[MAPPING] No confirmed mappings supplied.",
                );

                console.log(
                    "[MAPPING] Using automatic mappings:",
                    JSON.stringify(
                        mappings,
                        null,
                        2,
                    ),
                );
            }

            // ====================================================
            // Validate mappings
            // ====================================================

            const validMappings:
                ConfirmedMapping[] =
                [];

            for (
                const mapping of
                mappings
            ) {
                const sourceFile =
                    sourceFiles.find(
                        (file) =>
                            file.filename ===
                            mapping.sourceFile,
                    );

                if (!sourceFile) {
                    console.warn(
                        "[MAPPING] Source file not found:",
                        mapping,
                    );

                    continue;
                }

                const sourceColumnExists =
                    sourceFile.columns.some(
                        (column) =>
                            column.name ===
                            mapping.sourceColumn,
                    );

                if (
                    !sourceColumnExists
                ) {
                    console.warn(
                        "[MAPPING] Source column not found:",
                        mapping,
                    );

                    continue;
                }

                const targetColumnExists =
                    targetFile.columns.some(
                        (column) =>
                            column.name ===
                            mapping.targetColumn,
                    );

                if (
                    !targetColumnExists
                ) {
                    console.warn(
                        "[MAPPING] Target column not found:",
                        mapping,
                    );

                    continue;
                }

                if (
                    mapping.decision ===
                    "reject"
                ) {
                    console.log(
                        "[MAPPING] Rejected:",
                        mapping,
                    );

                    continue;
                }

                /*
                 * ここが重要。
                 *
                 * outputColumnはclientから渡された値ではなく、
                 * decisionから必ず再計算する。
                 *
                 * target:
                 *   売上高
                 *
                 * source:
                 *   sale
                 */
                mapping.outputColumn =
                    mapping.decision ===
                    "source"
                        ? mapping.sourceColumn
                        : mapping.targetColumn;

                validMappings.push(
                    mapping,
                );
            }

            console.log(
                "[MAPPING] Valid mappings:",
                JSON.stringify(
                    validMappings,
                    null,
                    2,
                ),
            );

            // ====================================================
            // Column merge definition
            // ====================================================
            //
            // targetの列を基本とする。
            //
            // source列がtarget列にマッピングされた場合、
            // 新しいdefinitionは作らない。
            //
            // 例:
            //
            // targetColumn = 売上高
            // sourceColumn = sale
            //
            // decision = target
            //   outputColumn = 売上高
            //
            // decision = source
            //   outputColumn = sale
            //
            // どちらも同じ「1つのdefinition」。
            // ====================================================

            type ColumnMergeDefinition = {
                targetColumn: string;

                outputColumn: string;

                sourceColumns: {
                    sourceFile: string;

                    sourceColumn: string;
                }[];
            };

            // ====================================================
            // 1. Target columns
            // ====================================================

            const definitions:
                ColumnMergeDefinition[] =
                [];

            const targetDefinitionMap =
                new Map<
                    string,
                    ColumnMergeDefinition
                >();

            for (
                const targetColumn of
                targetFile.columns
            ) {
                const definition:
                    ColumnMergeDefinition =
                {
                    targetColumn:
                        targetColumn.name,

                    outputColumn:
                        targetColumn.name,

                    sourceColumns: [],
                };

                definitions.push(
                    definition,
                );

                targetDefinitionMap.set(
                    targetColumn.name,
                    definition,
                );
            }

            // ====================================================
            // 2. Apply mappings
            //
            // 新しい列は作らない。
            //
            // 既存target definitionの
            // outputColumnだけを変更する。
            // ====================================================

            for (
                const mapping of
                validMappings
            ) {
                const definition =
                    targetDefinitionMap.get(
                        mapping.targetColumn,
                    );

                if (!definition) {
                    continue;
                }

                /*
                 * targetを選択した場合:
                 *
                 *   売上高
                 *
                 * sourceを選択した場合:
                 *
                 *   sale
                 */
                definition.outputColumn =
                    mapping.decision ===
                    "source"
                        ? mapping.sourceColumn
                        : mapping.targetColumn;

                const exists =
                    definition.sourceColumns.some(
                        (
                            source,
                        ) =>
                            source.sourceFile ===
                                mapping.sourceFile &&
                            source.sourceColumn ===
                                mapping.sourceColumn,
                    );

                if (!exists) {
                    definition.sourceColumns.push({
                        sourceFile:
                            mapping.sourceFile,

                        sourceColumn:
                            mapping.sourceColumn,
                    });
                }
            }

            // ====================================================
            // 3. Output column names must be unique
            //
            // 原則として新しい列を作らない。
            //
            // 同一target列に複数sourceが紐付いた場合でも、
            // 同じdefinitionを使う。
            // ====================================================

            const usedOutputColumns =
                new Set<string>();

            for (
                const definition of
                definitions
            ) {
                const desired =
                    definition.outputColumn;

                const uniqueName =
                    getUniqueColumnName(
                        usedOutputColumns,

                        desired,
                    );

                definition.outputColumn =
                    uniqueName;

                usedOutputColumns.add(
                    uniqueName,
                );
            }

            console.log(
                "[TRANSFORM] Column definitions:",
                JSON.stringify(
                    definitions,
                    null,
                    2,
                ),
            );

            // ====================================================
            // 4. Build target output rows
            //
            // targetファイルの行はそのまま保持。
            // ====================================================

            const outputRows:
                Record<
                    string,
                    CellValue
                >[] =
                targetFile.rows.map(
                    (targetRow) => {
                        const result:
                            Record<
                                string,
                                CellValue
                            > = {};

                        for (
                            const definition of
                            definitions
                        ) {
                            if (
                                definition.targetColumn
                            ) {
                                result[
                                    definition.outputColumn
                                ] =
                                    cloneValue(
                                        getValueByColumn(
                                            targetRow,
                                            definition.targetColumn,
                                        ),
                                    );
                            } else {
                                result[
                                    definition.outputColumn
                                ] = "";
                            }
                        }

                        return result;
                    },
                );

            // ====================================================
            // 5. Append source rows
            //
            // sourceの行を下方向へ追加する。
            //
            // ただし、source列は必ず既存の
            // target definitionへ入れる。
            //
            // そのため sale という新規列は作られない。
            // ====================================================

            for (
                const sourceFile of
                sourceFiles
            ) {
                const sourceMappings =
                    validMappings.filter(
                        (mapping) =>
                            mapping.sourceFile ===
                                sourceFile.filename &&
                            mapping.decision !==
                                "reject",
                    );

                if (
                    sourceMappings.length ===
                    0
                ) {
                    continue;
                }

                for (
                    const sourceRow of
                    sourceFile.rows
                ) {
                    const result:
                        Record<
                            string,
                            CellValue
                        > = {};

                    // --------------------------------------------
                    // 全列を空で初期化
                    // --------------------------------------------

                    for (
                        const definition of
                        definitions
                    ) {
                        result[
                            definition.outputColumn
                        ] = "";
                    }

                    // --------------------------------------------
                    // source値を対応する列へ入れる
                    // --------------------------------------------

                    for (
                        const mapping of
                        sourceMappings
                    ) {
                        const definition =
                            definitions.find(
                                (
                                    item,
                                ) =>
                                    item.targetColumn ===
                                        mapping.targetColumn &&
                                    item.sourceColumns.some(
                                        (
                                            source,
                                        ) =>
                                            source.sourceFile ===
                                                mapping.sourceFile &&
                                            source.sourceColumn ===
                                                mapping.sourceColumn,
                                    ),
                            );

                        if (
                            !definition
                        ) {
                            console.warn(
                                "[TRANSFORM] Definition not found:",
                                mapping,
                            );

                            continue;
                        }

                        const value =
                            getValueByColumn(
                                sourceRow,
                                mapping.sourceColumn,
                            );

                        /*
                         * target/sourceの選択に応じて
                         * 決定されたoutputColumnへ入れる。
                         */
                        result[
                            definition.outputColumn
                        ] =
                            cloneValue(
                                value,
                            );
                    }

                    outputRows.push(
                        result,
                    );
                }
            }

            // ====================================================
            // 6. Create workbook
            // ====================================================

            const workbook =
                new ExcelJS.Workbook();

            const worksheet =
                workbook.addWorksheet(
                    targetFile.sheetName ||
                        "Merged",
                );

            // ====================================================
            // Headers
            // ====================================================

            const outputColumns =
                definitions.map(
                    (
                        definition,
                    ) =>
                        definition.outputColumn,
                );

            worksheet.addRow(
                outputColumns,
            );

            // ====================================================
            // Data
            // ====================================================

            for (
                const row of
                outputRows
            ) {
                worksheet.addRow(
                    outputColumns.map(
                        (
                            column,
                        ) =>
                            row[column] ??
                            "",
                    ),
                );
            }

            // ====================================================
            // Basic formatting
            // ====================================================

            const headerRow =
                worksheet.getRow(1);

            headerRow.font = {
                bold: true,
            };

            headerRow.alignment = {
                vertical:
                    "middle",

                horizontal:
                    "center",
            };

            headerRow.fill = {
                type: "pattern",

                pattern:
                    "solid",

                fgColor: {
                    argb: "D9EAF7",
                },
            };

            worksheet.views = [
                {
                    state: "frozen",

                    ySplit: 1,
                },
            ];

            worksheet.columns =
                outputColumns.map(
                    (
                        column,
                        index,
                    ) => {
                        let maxLength =
                            column.length;

                        for (
                            let rowIndex = 2;
                            rowIndex <=
                            Math.min(
                                worksheet.rowCount,
                                101,
                            );
                            rowIndex++
                        ) {
                            const value =
                                worksheet
                                    .getRow(
                                        rowIndex,
                                    )
                                    .getCell(
                                        index + 1,
                                    )
                                    .value;

                            const length =
                                cellToString(
                                    value,
                                ).length;

                            maxLength =
                                Math.max(
                                    maxLength,
                                    length,
                                );
                        }

                        return {
                            header:
                                column,

                            key:
                                column,

                            width:
                                Math.min(
                                    Math.max(
                                        maxLength +
                                            2,
                                        10,
                                    ),
                                    50,
                                ),
                        };
                    },
                );

            // ====================================================
            // Response
            // ====================================================

            const outputBuffer =
                await workbook.xlsx.writeBuffer();

            const outputFilename =
                `${path.basename(
                    targetFile.filename,
                    path.extname(
                        targetFile.filename,
                    ),
                )}_merged.xlsx`;

            console.log(
                "[TRANSFORM] Output:",
                outputFilename,
            );

            console.log(
                "[TRANSFORM] Output rows:",
                outputRows.length,
            );

            console.log(
                "[API] /api/transform END",
            );

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${encodeURIComponent(
                    outputFilename,
                )}"`,
            );

            return res.send(
                Buffer.from(
                    outputBuffer,
                ),
            );
        } catch (error) {
            console.error(
                "[API] /api/transform ERROR:",
                error,
            );

            return res
                .status(500)
                .json({
                    error:
                        error instanceof Error
                            ? error.message
                            : "データ統合に失敗しました。",
                });
        }
    },
);

// ============================================================
// Health check
// ============================================================

app.get(
    "/api/health",
    (_req, res) => {
        res.json({
            ok: true,
        });
    },
);

// ============================================================
// Start server
// ============================================================

const PORT =
    Number(
        process.env.PORT ||
            3001,
    );

app.listen(
    PORT,
    () => {
        console.log(
            "========================================",
        );

        console.log(
            `[SERVER] Listening on port ${PORT}`,
        );

        console.log(
            `http://localhost:${PORT}`,
        );

        console.log(
            "========================================",
        );
    },
);
