import {
    CanonicalMapping,
    CanonicalColumn,
    MappingCandidate,
    ParsedFile,
} from "./types";
import { CANONICAL_SCHEMA } from "./schema";

/**
 * ============================================================
 * Column name normalization
 * ============================================================
 */

export const normalizeColumnName = (value: string): string => {
    return value.trim().replace(/\s+/g, " ").replace(/[\u3000]/g, " ");
};


export const normalizeForComparison = (value: string): string => {
    return normalizeColumnName(value).toLowerCase().replace(/[\s_\-./]/g, "");
};

/**
 * ============================================================
 * Exact / alias mapping
 * ============================================================
 */

function findCanonicalColumn(
    sourceColumn: string,
): CanonicalColumn | undefined {
    const normalizedSource = normalizeForComparison(sourceColumn);

    return CANONICAL_SCHEMA.columns.find((canonical) => {
        if (normalizeForComparison(canonical.name) === normalizedSource) {
            return true;
        }

        return canonical.aliases.some(
            (alias) => normalizeForComparison(alias) === normalizedSource,
        );
    });
}

/**
 * ============================================================
 * Fixed mapping
 * ============================================================
 *
 * AIを使わずに確定できるMapping。
 */

export const createFixedMappings = (
    sourceFiles: ParsedFile[],
): {
    mappings: CanonicalMapping[];
    unmappedColumns: {
        sourceFile: string;
        sourceColumn: string;
    }[];
} => {
    const mappings: CanonicalMapping[] = [];
    const unmappedColumns: {
        sourceFile: string;
        sourceColumn: string;
    }[] = [];

    for (const file of sourceFiles) {
        for (const sourceColumn of file.columns) {
            const canonical = findCanonicalColumn(sourceColumn.name);

            if (!canonical) {
                unmappedColumns.push({
                    sourceFile: file.filename,
                    sourceColumn: sourceColumn.name,
                });
                continue;
            }

            mappings.push({
                sourceFile: file.filename,
                sourceColumn: sourceColumn.name,
                canonicalKey: canonical.key,
                canonicalColumn: canonical.name,
                confidence: 1,
                reason: "Canonical Schemaの固定Mappingルールに一致しました。",
                decision: "target",
                outputColumn: canonical.name,
            });
        }
    }

    return {
        mappings,
        unmappedColumns,
    };
};


/**
 * ============================================================
 * AI candidate conversion
 * ============================================================
 *
 * 既存AIのMappingSuggestionをCanonical Mappingへ変換する。
 *
 * AIにはtarget Excelの列名ではなく、
 * Canonical Schemaを返させるのが理想。
 */

export const convertAICandidate = (
    candidate: MappingCandidate,
): CanonicalMapping | null => {
    const canonical = CANONICAL_SCHEMA.columns.find(
        (column) => column.key === candidate.candidateCanonicalKey,
    );

    if (!canonical) {
        return null;
    }

    if (candidate.confidence < 0.7) {
        return null;
    }

    return {
        sourceFile: candidate.sourceFile,
        sourceColumn: candidate.sourceColumn,
        canonicalKey: canonical.key,
        canonicalColumn: canonical.name,
        confidence: candidate.confidence,
        reason: candidate.reason,
        decision: "target",
        outputColumn: canonical.name,
    };
};


/**
 * ============================================================
 * Build AI candidates
 * ============================================================
 */

export const createAIMappingCandidates = (
    sourceFiles: ParsedFile[],
    existingMappings: CanonicalMapping[],
): MappingCandidate[] => {
    const mappedKeys = new Set(
        existingMappings.map(
            (mapping) => `${mapping.sourceFile}:${mapping.sourceColumn}`,
        ),
    );

    const candidates: MappingCandidate[] = [];

    for (const file of sourceFiles) {
        for (const column of file.columns) {
            const identifier = `${file.filename}:${column.name}`;

            if (mappedKeys.has(identifier)) {
                continue;
            }

            for (const canonical of CANONICAL_SCHEMA.columns) {
                candidates.push({
                    sourceFile: file.filename,
                    sourceColumn: column.name,
                    candidateCanonicalKey: canonical.key,
                    candidateColumn: canonical.name,
                    confidence: 0,
                    reason: "",
                });
            }
        }
    }

    return candidates;
};


/**
 * ============================================================
 * Validate canonical mapping
 * ============================================================
 */

export const validateCanonicalMappings = (
    mappings: CanonicalMapping[],
    sourceFiles: ParsedFile[],
): CanonicalMapping[] => {
    const valid: CanonicalMapping[] = [];
    const usedSourceColumns = new Set<string>();

    for (const mapping of mappings) {
        if (mapping.decision === "reject") {
            continue;
        }

        const canonical = CANONICAL_SCHEMA.columns.find(
            (column) => column.key === mapping.canonicalKey,
        );

        if (!canonical) {
            continue;
        }

        const sourceFile = sourceFiles.find(
            (file) => file.filename === mapping.sourceFile,
        );

        if (!sourceFile) {
            continue;
        }

        const sourceColumnExists = sourceFile.columns.some(
            (column) => column.name === mapping.sourceColumn,
        );

        if (!sourceColumnExists) {
            continue;
        }

        const sourceIdentifier = `${mapping.sourceFile}:${mapping.sourceColumn}`;

        if (usedSourceColumns.has(sourceIdentifier)) {
            continue;
        }

        usedSourceColumns.add(sourceIdentifier);

        valid.push({
            ...mapping,
            canonicalColumn: canonical.name,
            outputColumn: canonical.name,
        });
    }

    return valid;
};
