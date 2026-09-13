export type CanonicalDataType = "string" | "number" | "date" | "boolean";

export type MappingDecision = "target" | "source" | "reject";

export type CellValue = string | number | boolean | Date | null | undefined;

export type ColumnInfo = {
    name: string;
    type: CanonicalDataType | "unknown";
    samples: string[];
};

export type CanonicalColumn = {
    /**
     * システム内部で利用する固定キー
     *
     * 例:
     * sales_amount
     */
    key: string;

    /**
     * 本部Excelに出力する列名
     *
     * 例:
     * 売上高
     */
    name: string;

    /**
     * Canonical上のデータ型
     */
    type: CanonicalDataType;

    /**
     * 必須項目か
     */
    required: boolean;

    /**
     * 入力Excelで考えられる別名
     */
    aliases: string[];

    /**
     * 値を正規化するための種別
     */
    normalizer: "string" | "trim" | "number" | "date" | "boolean" | "store_id";
};

export type CanonicalSchema = {
    version: string;
    columns: CanonicalColumn[];
};

export type CanonicalMapping = {
    sourceFile: string;
    sourceColumn: string;
    canonicalKey: string;
    canonicalColumn: string;
    confidence: number;
    reason: string;
    decision: MappingDecision;

    /**
     * source / targetどちらを採用するか。
     *
     * 出力列名には利用しない。
     * 出力列名はCanonical Schemaで固定する。
     */
    outputColumn: string;
};

export type MappingCandidate = {
    sourceFile: string;
    sourceColumn: string;
    candidateCanonicalKey: string;
    candidateColumn: string;
    confidence: number;
    reason: string;
};

export type ValidationError = {
    rowIndex: number;
    column: string;
    code: "REQUIRED" | "TYPE" | "INVALID_DATE" | "INVALID_NUMBER" | "INVALID_BOOLEAN";
    message: string;
    value: string;
};

export type ValidationResult = {
    valid: boolean;
    errors: ValidationError[];
    errorCount: number;
};

export type ParsedFile = {
    id: string;
    filename: string;
    type: "csv" | "xlsx";
    sheetName: string;
    columns: ColumnInfo[];
    rows: Record<string, CellValue>[];
};

export type NormalizedRow = Record<string, CellValue>;
