import {
    CellValue,
    CanonicalMapping,
    NormalizedRow,
    ParsedFile,
} from "../canonical/types";

/**
 * ============================================================
 * Merger
 * ============================================================
 */

export type MergeDefinition = {
    targetColumn: string;

    outputColumn: string;

    sourceColumns: {
        sourceFile: string;

        sourceColumn: string;
    }[];
};

/**
 * 現在の実装ではサーバー側で使っている
 * ConfirmedMappingと互換の型。
 *
 * CanonicalMappingを直接使う場合にも対応できるように
 * 必要なフィールドだけを利用する。
 */
export type MergeMapping = Pick<
    CanonicalMapping,
    | "sourceFile"
    | "sourceColumn"
    | "canonicalColumn"
    | "decision"
    | "outputColumn"
> & {
    /**
     * 現在のフロントから送られている
     * targetColumnにも対応。
     */
    targetColumn?: string;
};

/**
 * 値をcloneする。
 */
function cloneValue(
    value: CellValue,
): CellValue {
    if (value instanceof Date) {
        return new Date(
            value.getTime(),
        );
    }

    return value;
}

/**
 * 出力列名を一意にする。
 */
function getUniqueColumnName(
    existing: Set<string>,
    desired: string,
): string {
    const base =
        desired.trim() ||
        "Column";

    if (!existing.has(base)) {
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

/**
 * source rowから値を取得する。
 */
function getValueByColumn(
    row: NormalizedRow,
    columnName: string,
): CellValue {
    return row[columnName];
}

/**
 * mappingのtarget列名を取得する。
 *
 * 現行API:
 *   targetColumn
 *
 * CanonicalMapping:
 *   canonicalColumn
 *
 * の両方を許容する。
 */
function getTargetColumn(
    mapping: MergeMapping,
): string {
    return (
        mapping.targetColumn ||
        mapping.canonicalColumn
    );
}

/**
 * ============================================================
 * Mapping validation
 * ============================================================
 */

export function validateMappings(
    mappings: MergeMapping[],
    targetFile: ParsedFile,
    sourceFiles: ParsedFile[],
): MergeMapping[] {
    const validMappings:
        MergeMapping[] = [];

    for (
        const mapping of mappings
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

        if (!sourceColumnExists) {
            console.warn(
                "[MAPPING] Source column not found:",
                mapping,
            );

            continue;
        }

        const targetColumn =
            getTargetColumn(mapping);

        const targetColumnExists =
            targetFile.columns.some(
                (column) =>
                    column.name ===
                    targetColumn,
            );

        if (!targetColumnExists) {
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

        /**
         * outputColumnは入力値を信用せず、
         * decisionから再計算する。
         */
        mapping.outputColumn =
            mapping.decision ===
                "source"
                ? mapping.sourceColumn
                : targetColumn;

        validMappings.push(
            mapping,
        );
    }

    return validMappings;
}

/**
 * ============================================================
 * Column definitions
 * ============================================================
 */

export function createMergeDefinitions(
    targetFile: ParsedFile,
    mappings: MergeMapping[],
): MergeDefinition[] {
    const definitions:
        MergeDefinition[] = [];

    const targetDefinitionMap =
        new Map<
            string,
            MergeDefinition
        >();

    /**
     * Targetの列を基本定義にする。
     */
    for (
        const targetColumn of
        targetFile.columns
    ) {
        const definition:
            MergeDefinition = {
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

    /**
     * Mappingを既存definitionへ紐付ける。
     *
     * 新しい列definitionは作らない。
     */
    for (
        const mapping of mappings
    ) {
        const targetColumn =
            getTargetColumn(mapping);

        const definition =
            targetDefinitionMap.get(
                targetColumn,
            );

        if (!definition) {
            continue;
        }

        definition.outputColumn =
            mapping.decision ===
                "source"
                ? mapping.sourceColumn
                : targetColumn;

        const exists =
            definition.sourceColumns.some(
                (source) =>
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

    /**
     * outputColumnの重複を防ぐ。
     */
    const usedOutputColumns =
        new Set<string>();

    for (
        const definition of
        definitions
    ) {
        const uniqueName =
            getUniqueColumnName(
                usedOutputColumns,
                definition.outputColumn,
            );

        definition.outputColumn =
            uniqueName;

        usedOutputColumns.add(
            uniqueName,
        );
    }

    return definitions;
}

/**
 * ============================================================
 * Merge
 * ============================================================
 */

export function mergeFiles(
    targetFile: ParsedFile,
    sourceFiles: ParsedFile[],
    mappings: MergeMapping[],
): {
    rows: NormalizedRow[];

    definitions: MergeDefinition[];
} {
    const validMappings =
        validateMappings(
            mappings,
            targetFile,
            sourceFiles,
        );

    const definitions =
        createMergeDefinitions(
            targetFile,
            validMappings,
        );

    console.log(
        "[MERGE] Definitions:",
        JSON.stringify(
            definitions,
            null,
            2,
        ),
    );

    /**
     * ========================================================
     * Target rows
     * ========================================================
     */

    const outputRows:
        NormalizedRow[] =
        targetFile.rows.map(
            (targetRow) => {
                const result:
                    NormalizedRow = {};

                for (
                    const definition of
                    definitions
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
                }

                return result;
            },
        );

    /**
     * ========================================================
     * Source rows
     * ========================================================
     */

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
            sourceMappings.length === 0
        ) {
            continue;
        }

        for (
            const sourceRow of
            sourceFile.rows
        ) {
            const result:
                NormalizedRow = {};

            /**
             * 全列を空で初期化。
             */
            for (
                const definition of
                definitions
            ) {
                result[
                    definition.outputColumn
                ] = "";
            }

            /**
             * source値を既存definitionへ入れる。
             */
            for (
                const mapping of
                sourceMappings
            ) {
                const targetColumn =
                    getTargetColumn(
                        mapping,
                    );

                const definition =
                    definitions.find(
                        (item) =>
                            item.targetColumn ===
                            targetColumn &&
                            item.sourceColumns.some(
                                (source) =>
                                    source.sourceFile ===
                                    mapping.sourceFile &&
                                    source.sourceColumn ===
                                    mapping.sourceColumn,
                            ),
                    );

                if (!definition) {
                    console.warn(
                        "[MERGE] Definition not found:",
                        mapping,
                    );

                    continue;
                }

                const value =
                    getValueByColumn(
                        sourceRow,
                        mapping.sourceColumn,
                    );

                result[
                    definition.outputColumn
                ] =
                    cloneValue(value);
            }

            outputRows.push(
                result,
            );
        }
    }

    console.log(
        "[MERGE] Output rows:",
        outputRows.length,
    );

    return {
        rows: outputRows,

        definitions,
    };
}
