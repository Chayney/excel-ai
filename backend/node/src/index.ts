import express from "express";
import multer from "multer";
import cors from "cors";
import crypto from "crypto";
import path from "path";

import {
    AIProvider,
} from "./ai/aiProvider";

import {
    createAIProvider,
} from "./ai/createaiProvider";

import {
    parseInputFile,
} from "./engine/parser";

import {
    mergeFiles,
    MergeMapping,
} from "./engine/merger";

import {
    exportToXlsx,
} from "./engine/exporter";

import {
    ColumnInfo,
    ParsedFile,
    MappingDecision,
} from "./canonical/types";

// ============================================================
// Types
// ============================================================

type MappingSuggestion = {
    id: string;

    sourceFile: string;

    sourceColumn: string;

    candidateColumn: string;

    confidence: number;

    reason: string;
};

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
                confidence = 0.8;
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
    sourceFiles: ParsedFile[],
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
                column.name.trim();

            /**
             * ==================================================
             * 完全一致
             * ==================================================
             */

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

            /**
             * ==================================================
             * 正規化一致
             * ==================================================
             */

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

            /**
             * ==================================================
             * AI候補
             * ==================================================
             */

            aiCandidates.push({
                sourceFile:
                    file.filename,

                column,
            });
        }
    }

    /**
     * AIに渡す候補がない場合。
     */
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
        /**
         * Source存在確認
         */
        const sourceExists =
            aiCandidates.some(
                (source) =>
                    source.sourceFile ===
                    suggestion.sourceFile &&
                    source.column.name ===
                    suggestion.sourceColumn,
            );

        if (!sourceExists) {
            continue;
        }

        /**
         * Target存在確認
         */
        const targetExists =
            targetColumns.some(
                (
                    targetColumn,
                ) =>
                    targetColumn.name ===
                    suggestion.candidateColumn,
            );

        if (!targetExists) {
            continue;
        }

        /**
         * confidence確認
         */
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

    /**
     * confidence降順
     */
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
): MergeMapping[] {
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
            MergeMapping[] =
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
                "string"
            ) {
                continue;
            }

            /**
             * targetColumnを優先。
             *
             * canonicalColumnを送るクライアントにも
             * 対応する。
             */
            const targetColumn =
                typeof raw.targetColumn ===
                    "string"
                    ? raw.targetColumn
                    : typeof raw.canonicalColumn ===
                        "string"
                        ? raw.canonicalColumn
                        : "";

            if (!targetColumn) {
                continue;
            }

            const decision =
                raw.decision ===
                    "source" ||
                    raw.decision ===
                    "reject"
                    ? raw.decision
                    : "target";

            /**
             * outputColumnはclientから来た値を
             * そのまま信用しない。
             */
            const outputColumn =
                decision === "source"
                    ? raw.sourceColumn
                    : targetColumn;

            /**
             * marger.tsはcanonicalColumnを
             * 基本フィールドとして使用する。
             */
            result.push({
                sourceFile:
                    raw.sourceFile,

                sourceColumn:
                    raw.sourceColumn,

                canonicalColumn:
                    targetColumn,

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

            /**
             * ==================================================
             * Parse
             * ==================================================
             */

            const parsedFiles =
                await Promise.all(
                    files.map(
                        (file) =>
                            parseInputFile(
                                file,
                            ),
                    ),
                );

            /**
             * ==================================================
             * Target
             * ==================================================
             *
             * 先頭ファイルを統合先とする。
             */

            const targetFile =
                parsedFiles[0];

            if (!targetFile) {
                return res
                    .status(400)
                    .json({
                        error:
                            "統合先ファイルが見つかりません。",
                    });
            }

            /**
             * ==================================================
             * Sources
             * ==================================================
             */

            const sourceFiles =
                parsedFiles.slice(1);

            /**
             * ==================================================
             * AI Mapping
             * ==================================================
             */

            const mapping =
                await createMappingSuggestions(
                    sourceFiles,

                    targetFile.columns,

                    organizationKey,

                    aiProvider,
                );

            /**
             * ==================================================
             * Unmatched source columns
             * ==================================================
             */

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

            /**
             * ==================================================
             * Unmatched target columns
             * ==================================================
             */

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

            /**
             * ==================================================
             * Response
             * ==================================================
             */

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

            /**
             * ==================================================
             * Parse
             * ==================================================
             */

            const parsedFiles =
                await Promise.all(
                    files.map(
                        (file) =>
                            parseInputFile(
                                file,
                            ),
                    ),
                );

            /**
             * ==================================================
             * Target
             * ==================================================
             *
             * 先頭ファイルを統合先にする。
             */

            const targetFile =
                parsedFiles[0];

            if (!targetFile) {
                return res
                    .status(400)
                    .json({
                        error:
                            "統合先ファイルが見つかりません。",
                    });
            }

            /**
             * ==================================================
             * Sources
             * ==================================================
             */

            const sourceFiles =
                parsedFiles.slice(1);

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

            /**
             * ==================================================
             * Confirmed mappings
             * ==================================================
             */

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

            /**
             * ==================================================
             * Mapping
             * ==================================================
             */

            let mappings:
                MergeMapping[] =
                confirmedMappings;

            /**
             * confirmedMappingsがない場合は
             * 自動Mappingを使う。
             */
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
                        .automaticMappings
                        .map(
                            (mapping) => ({
                                sourceFile:
                                    mapping.sourceFile,

                                sourceColumn:
                                    mapping.sourceColumn,

                                canonicalColumn:
                                    mapping.targetColumn,

                                decision:
                                    mapping.decision,

                                outputColumn:
                                    mapping.outputColumn,
                            }),
                        );

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

            /**
             * ==================================================
             * Merge
             * ==================================================
             */

            const merged =
                mergeFiles(
                    targetFile,

                    sourceFiles,

                    mappings,
                );

            console.log(
                "[MERGE] Rows:",
                merged.rows.length,
            );

            console.log(
                "[MERGE] Definitions:",
                JSON.stringify(
                    merged.definitions,
                    null,
                    2,
                ),
            );

            /**
             * ==================================================
             * Export
             * ==================================================
             */

            const outputBuffer =
                await exportToXlsx(
                    merged.rows,

                    merged.definitions,

                    {
                        sheetName:
                            targetFile.sheetName ||
                            "Merged",
                    },
                );

            /**
             * ==================================================
             * Output filename
             * ==================================================
             */

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
                merged.rows.length,
            );

            console.log(
                "[API] /api/transform END",
            );

            /**
             * ==================================================
             * Response
             * ==================================================
             */

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
                outputBuffer,
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
