import {
  useMemo,
  useState,
} from "react";

import styles from "./app.module.css";

type ColumnInfo = {
  name: string;
  type: string;
  samples: string[];
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

  /*
   * target:
   *   統合先側の値を採用
   *
   * source:
   *   入力側の値を採用
   *
   * outputColumnは常にtargetColumn。
   */
  decision: MappingDecision;

  outputColumn: string;
};

type AnalyzeFile = {
  filename: string;

  sheetName: string;

  columns: ColumnInfo[];

  rowCount: number;
};

type AnalyzeResponse = {
  files: AnalyzeFile[];

  target: {
    filename: string;

    sheetName: string;

    columns: ColumnInfo[];
  };

  suggestions: MappingSuggestion[];

  automaticMappings:
  ConfirmedMapping[];

  unmatchedSourceColumns:
  string[];

  unmatchedTargetColumns:
  string[];
};

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:3000";

function App() {
  const [
    files,
    setFiles,
  ] = useState<File[]>([]);

  const [
    organizationKey,
    setOrganizationKey,
  ] = useState(
    "demo-company",
  );

  const [
    result,
    setResult,
  ] =
    useState<AnalyzeResponse | null>(
      null,
    );

  const [
    confirmedMappings,
    setConfirmedMappings,
  ] =
    useState<
      ConfirmedMapping[]
    >([]);

  const [
    rejectedSuggestions,
    setRejectedSuggestions,
  ] =
    useState<string[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    processing,
    setProcessing,
  ] = useState(false);

  const [
    showSuggestionDialog,
    setShowSuggestionDialog,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  // ============================================================
  // File
  // ============================================================

  function addFiles(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    if (!event.target.files) {
      return;
    }

    const selectedFiles =
      Array.from(
        event.target.files,
      );

    setFiles(
      selectedFiles,
    );

    setResult(null);

    setConfirmedMappings(
      [],
    );

    setRejectedSuggestions(
      [],
    );

    setShowSuggestionDialog(
      false,
    );

    setError("");
  }

  // ============================================================
  // Analyze
  // ============================================================

  async function analyze() {
    setError("");

    setResult(null);

    setConfirmedMappings(
      [],
    );

    setRejectedSuggestions(
      [],
    );

    setShowSuggestionDialog(
      false,
    );

    if (
      files.length < 2
    ) {
      setError(
        "統合には2ファイル以上を選択してください。1つ目のファイルが統合先になります。",
      );

      return;
    }

    setLoading(true);

    console.log(
      "========================================",
    );

    console.log(
      "[FRONTEND] AI analyze START",
    );

    console.log(
      "[FRONTEND] files:",
      files.map(
        (file) =>
          file.name,
      ),
    );

    console.log(
      "[FRONTEND] target file:",
      files[0]?.name,
    );

    try {
      const formData =
        new FormData();

      files.forEach(
        (file) => {
          formData.append(
            "files",
            file,
          );
        },
      );

      formData.append(
        "organizationKey",
        organizationKey,
      );

      const response =
        await fetch(
          `${API_URL}/api/analyze`,
          {
            method: "POST",

            body: formData,
          },
        );

      if (
        !response.ok
      ) {
        let message =
          "AI解析に失敗しました。";

        try {
          const data =
            await response.json();

          if (
            data?.error
          ) {
            message =
              data.error;
          }
        } catch {
          // ignore
        }

        throw new Error(
          message,
        );
      }

      const data =
        (await response.json()) as AnalyzeResponse;

      console.log(
        "[FRONTEND] AI analyze result:",
        data,
      );

      setResult(data);

      setConfirmedMappings(
        data.automaticMappings ??
        [],
      );
    } catch (err) {
      console.error(
        "[FRONTEND] Analyze error:",
        err,
      );

      if (
        err instanceof Error
      ) {
        setError(
          err.message,
        );
      } else {
        setError(
          "AI解析に失敗しました。",
        );
      }
    } finally {
      setLoading(false);

      console.log(
        "[FRONTEND] AI analyze END",
      );

      console.log(
        "========================================",
      );
    }
  }

  // ============================================================
  // Pending suggestions
  // ============================================================

  const pendingSuggestions =
    useMemo(() => {
      if (!result) {
        return [];
      }

      const suggestions =
        result.suggestions ??
        [];

      return suggestions.filter(
        (suggestion) => {
          const rejected =
            rejectedSuggestions.includes(
              suggestion.id,
            );

          const confirmed =
            confirmedMappings.some(
              (mapping) =>
                mapping.sourceFile ===
                suggestion.sourceFile &&
                mapping.sourceColumn ===
                suggestion.sourceColumn,
            );

          return (
            !rejected &&
            !confirmed
          );
        },
      );
    }, [
      result,
      rejectedSuggestions,
      confirmedMappings,
    ]);

  // ============================================================
  // Current suggestion
  // ============================================================

  const currentSuggestion =
    pendingSuggestions[0];

  // ============================================================
  // Open AI suggestion dialog
  // ============================================================

  function openSuggestionDialog() {
    if (
      !currentSuggestion
    ) {
      return;
    }

    setShowSuggestionDialog(
      true,
    );
  }

  // ============================================================
  // Mapping decision
  // ============================================================

  function confirmSuggestion(
    decision: MappingDecision,
  ) {
    if (
      !currentSuggestion ||
      !result
    ) {
      return;
    }

    /*
     * decisionは「どちらの値を採用するか」。
     *
     * sourceを選択しても、
     * 出力列名はsourceColumnではない。
     *
     * 例:
     *
     * sourceColumn = sale
     * targetColumn = 売上高
     * decision = source
     *
     * ↓
     *
     * saleの値を採用
     * 出力先は売上高
     */

    const outputColumn =
      currentSuggestion.candidateColumn;

    console.log(
      "[FRONTEND] AI suggestion decision:",
      {
        suggestion:
          currentSuggestion,

        decision,

        sourceColumn:
          currentSuggestion.sourceColumn,

        targetColumn:
          currentSuggestion.candidateColumn,

        outputColumn,
      },
    );

    setConfirmedMappings(
      (previous) => {
        const alreadyExists =
          previous.some(
            (mapping) =>
              mapping.sourceFile ===
              currentSuggestion.sourceFile &&
              mapping.sourceColumn ===
              currentSuggestion.sourceColumn,
          );

        if (
          alreadyExists
        ) {
          return previous;
        }

        return [
          ...previous,

          {
            sourceFile:
              currentSuggestion.sourceFile,

            sourceColumn:
              currentSuggestion.sourceColumn,

            targetColumn:
              currentSuggestion.candidateColumn,

            decision,

            outputColumn,
          },
        ];
      },
    );

    setShowSuggestionDialog(
      false,
    );
  }

  // ============================================================
  // Reject
  // ============================================================

  function rejectSuggestion() {
    if (
      !currentSuggestion
    ) {
      return;
    }

    console.log(
      "[FRONTEND] AI suggestion rejected:",
      currentSuggestion,
    );

    setRejectedSuggestions(
      (previous) => {
        if (
          previous.includes(
            currentSuggestion.id,
          )
        ) {
          return previous;
        }

        return [
          ...previous,

          currentSuggestion.id,
        ];
      },
    );

    setShowSuggestionDialog(
      false,
    );
  }

  // ============================================================
  // Transform
  // ============================================================

  async function transform() {
    if (!result) {
      return;
    }

    if (
      pendingSuggestions.length >
      0
    ) {
      setError(
        "AI候補をすべて確認してください。",
      );

      return;
    }

    setError("");

    setProcessing(true);

    console.log(
      "========================================",
    );

    console.log(
      "[FRONTEND] Excel transform START",
    );

    console.log(
      "[FRONTEND] confirmed mappings:",
      confirmedMappings,
    );

    try {
      const formData =
        new FormData();

      files.forEach(
        (file) => {
          formData.append(
            "files",
            file,
          );
        },
      );

      formData.append(
        "organizationKey",
        organizationKey,
      );

      /*
       * IMPORTANT:
       *
       * BackendはconfirmedMappingsを読む。
       */

      formData.append(
        "confirmedMappings",
        JSON.stringify(
          confirmedMappings,
        ),
      );

      const response =
        await fetch(
          `${API_URL}/api/transform`,
          {
            method: "POST",

            body: formData,
          },
        );

      if (
        !response.ok
      ) {
        let message =
          "Excel生成に失敗しました。";

        try {
          const contentType =
            response.headers.get(
              "content-type",
            );

          if (
            contentType?.includes(
              "application/json",
            )
          ) {
            const data =
              await response.json();

            if (
              data?.error
            ) {
              message =
                data.error;
            }
          }
        } catch {
          // ignore
        }

        throw new Error(
          message,
        );
      }

      const blob =
        await response.blob();

      const url =
        window.URL.createObjectURL(
          blob,
        );

      const anchor =
        document.createElement(
          "a",
        );

      anchor.href =
        url;

      anchor.download =
        "統合結果.xlsx";

      document.body.appendChild(
        anchor,
      );

      anchor.click();

      anchor.remove();

      window.URL.revokeObjectURL(
        url,
      );

      console.log(
        "[FRONTEND] Excel transform completed.",
      );
    } catch (err) {
      console.error(
        "[FRONTEND] Transform error:",
        err,
      );

      if (
        err instanceof Error
      ) {
        setError(
          err.message,
        );
      } else {
        setError(
          "Excel生成に失敗しました。",
        );
      }
    } finally {
      setProcessing(false);

      console.log(
        "[FRONTEND] Excel transform END",
      );

      console.log(
        "========================================",
      );
    }
  }

  // ============================================================
  // Reset
  // ============================================================

  function reset() {
    setFiles([]);

    setResult(null);

    setConfirmedMappings(
      [],
    );

    setRejectedSuggestions(
      [],
    );

    setShowSuggestionDialog(
      false,
    );

    setError("");
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className={styles.app}>

      <header className={styles.header}>
        <div>
          <h1>
            Excel AI Integrator
          </h1>

          <p>
            AIがExcel / CSVの列の意味を解析し、
            ユーザー確認後に統合します。
          </p>
        </div>
      </header>

      <main className={styles.container}>

        {/* ================================================== */}
        {/* Basic */}
        {/* ================================================== */}

        <section className={styles.card}>

          <h2>
            1. 基本設定
          </h2>

          <label htmlFor="organizationKey">
            会社・業務識別子
          </label>

          <input
            id="organizationKey"
            value={
              organizationKey
            }
            onChange={(
              event,
            ) =>
              setOrganizationKey(
                event.target.value,
              )
            }
            placeholder="demo-company"
          />

          <p className={styles.help}>
            過去のユーザー判断をAIの参考情報として
            利用するための識別子です。
          </p>

        </section>

        {/* ================================================== */}
        {/* Files */}
        {/* ================================================== */}

        <section className={styles.card}>

          <h2>
            2. 入力ファイル
          </h2>

          <p className={styles.help}>
            1つ目に選択したファイルが
            統合先（マスター）になります。
            2つ目以降のファイルをAIが解析します。
          </p>

          <label className={styles.fileButton}>

            Excel / CSVを選択

            <input
              type="file"
              multiple
              accept=".xlsx,.csv"
              onChange={
                addFiles
              }
            />

          </label>

          {files.length >
            0 && (
              <div className={styles.fileList}>

                {files.map(
                  (
                    file,
                    index,
                  ) => (
                    <div
                      className={styles.fileItem}
                      key={`${file.name}-${index}`}
                    >

                      {index ===
                        0 && (
                          <strong>
                            [統合先]{" "}
                          </strong>
                        )}

                      {index >
                        0 && (
                          <span>
                            [AI解析対象]{" "}
                          </span>
                        )}

                      {
                        file.name
                      }

                    </div>
                  ),
                )}

              </div>
            )}

          <button
            className={styles.primaryButton}
            onClick={
              analyze
            }
            disabled={
              loading ||
              files.length <
              2
            }
          >
            {loading
              ? "AI解析中..."
              : "AI解析を開始"}
          </button>

        </section>

        {/* ================================================== */}
        {/* Error */}
        {/* ================================================== */}

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {/* ================================================== */}
        {/* Analysis result */}
        {/* ================================================== */}

        {result && (
          <section className={styles.card}>

            <h2>
              3. 解析結果
            </h2>

            <div className={styles.summary}>

              <div>
                <span>
                  入力ファイル
                </span>

                <strong>
                  {
                    result.files
                      .length
                  }
                </strong>
              </div>

              <div>
                <span>
                  統合先列
                </span>

                <strong>
                  {
                    result.target
                      .columns
                      .length
                  }
                </strong>
              </div>

              <div>
                <span>
                  確定済み
                </span>

                <strong>
                  {
                    confirmedMappings
                      .length
                  }
                </strong>
              </div>

              <div>
                <span>
                  AI確認待ち
                </span>

                <strong>
                  {
                    pendingSuggestions
                      .length
                  }
                </strong>
              </div>

            </div>

            {/* ================================================= */}
            {/* Target */}
            {/* ================================================= */}

            <div className={styles.mappingSection}>

              <h3>
                統合先
              </h3>

              <p>
                {
                  result.target
                    .filename
                }
              </p>

              <div className={styles.mappingList}>

                {result.target.columns.map(
                  (
                    column,
                  ) => (
                    <div
                      className={styles.mappingItem}
                      key={
                        column.name
                      }
                    >

                      <strong>
                        {
                          column.name
                        }
                      </strong>

                      <small>
                        {
                          column.type
                        }
                      </small>

                    </div>
                  ),
                )}

              </div>

            </div>

            {/* ================================================= */}
            {/* Mapping */}
            {/* ================================================= */}

            <div className={styles.mappingSection}>

              <h3>
                現在のマッピング
              </h3>

              {confirmedMappings.length ===
                0 ? (
                <p className={styles.help}>
                  まだ確定したマッピングはありません。
                </p>
              ) : (
                <div className={styles.mappingList}>

                  {confirmedMappings.map(
                    (
                      mapping,
                      index,
                    ) => (
                      <div
                        className={styles.mappingItem}
                        key={`${mapping.sourceFile}-${mapping.sourceColumn}-${index}`}
                      >

                        <div>

                          <strong>
                            {
                              mapping.sourceColumn
                            }
                          </strong>

                          <small>
                            {
                              mapping.sourceFile
                            }
                          </small>

                        </div>

                        <span>
                          →
                        </span>

                        <div>

                          <strong>
                            {
                              mapping.outputColumn
                            }
                          </strong>

                          <small>
                            {mapping.decision ===
                              "source"
                              ? "入力側の値を採用"
                              : mapping.decision ===
                                "target"
                                ? "統合先の値を採用"
                                : "統合しない"}
                          </small>

                        </div>

                      </div>
                    ),
                  )}

                </div>
              )}

            </div>

            {/* ================================================= */}
            {/* Unmatched */}
            {/* ================================================= */}

            {result.unmatchedSourceColumns
              .length >
              0 && (
                <div className={styles.warningBox}>

                  <h3>
                    未マッピングの入力列
                  </h3>

                  {result.unmatchedSourceColumns.map(
                    (
                      column,
                    ) => (
                      <div
                        key={column}
                      >
                        {
                          column
                        }
                      </div>
                    ),
                  )}

                </div>
              )}

            {result.unmatchedTargetColumns
              .length >
              0 && (
                <div className={styles.warningBox}>

                  <h3>
                    未使用の統合先列
                  </h3>

                  {result.unmatchedTargetColumns.map(
                    (
                      column,
                    ) => (
                      <div
                        key={column}
                      >
                        {
                          column
                        }
                      </div>
                    ),
                  )}

                </div>
              )}

            {/* ================================================= */}
            {/* AI Suggestions */}
            {/* ================================================= */}

            {pendingSuggestions.length >
              0 && (
                <button
                  className={styles.primaryButton}
                  onClick={
                    openSuggestionDialog
                  }
                  disabled={
                    processing
                  }
                >
                  AI候補を確認してください
                  （残り{" "}
                  {
                    pendingSuggestions.length
                  }
                  件）
                </button>
              )}

            {/* ================================================= */}
            {/* Transform */}
            {/* ================================================= */}

            <button
              className={styles.primaryButton}
              onClick={
                transform
              }
              disabled={
                processing ||
                pendingSuggestions.length >
                0
              }
            >
              {processing
                ? "Excel生成中..."
                : pendingSuggestions.length >
                  0
                  ? "AI候補を確認してください"
                  : "統合Excelを生成"}
            </button>

            <button
              className={styles.secondaryButton}
              onClick={
                reset
              }
            >
              最初からやり直す
            </button>

          </section>
        )}

      </main>

      {/* ====================================================== */}
      {/* AI Confirmation Modal */}
      {/* ====================================================== */}

      {showSuggestionDialog &&
        currentSuggestion && (
          <div
            className={styles.modalOverlay}
            onClick={() =>
              setShowSuggestionDialog(
                false,
              )
            }
          >

            <div
              className={styles.modal}
              onClick={(event) =>
                event.stopPropagation()
              }
            >

              <div className={styles.modalHeader}>

                <div>

                  <span className={styles.aiLabel}>
                    AIによる統合候補
                  </span>

                  <h2>
                    同じ意味の可能性がある列
                  </h2>

                </div>

                <div className={styles.confidence}>

                  {Math.round(
                    currentSuggestion.confidence *
                    100,
                  )}
                  %

                </div>

              </div>

              <div className={styles.mappingPreview}>

                <div className={styles.columnBox}>

                  <span>
                    入力ファイル
                  </span>

                  <small>
                    {
                      currentSuggestion.sourceFile
                    }
                  </small>

                  <strong>
                    {
                      currentSuggestion.sourceColumn
                    }
                  </strong>

                </div>

                <div className={styles.arrow}>
                  ↔
                </div>

                <div
                  className={`${styles.columnBox} ${styles.target}`}
                >

                  <span>
                    統合先
                  </span>

                  <strong>
                    {
                      currentSuggestion.candidateColumn
                    }
                  </strong>

                </div>

              </div>

              <div className={styles.reason}>

                <strong>
                  AIの判断理由
                </strong>

                <p>
                  {
                    currentSuggestion.reason
                  }
                </p>

              </div>

              <div className={styles.modalQuestion}>

                この候補を統合します。
                どちらのデータを採用しますか？

              </div>

              <div className={styles.modalActions}>

                <button
                  className={styles.targetButton}
                  onClick={() =>
                    confirmSuggestion(
                      "target",
                    )
                  }
                >

                  <strong>
                    {
                      currentSuggestion.candidateColumn
                    }
                  </strong>

                  <span>
                    統合先の値を採用
                  </span>

                </button>

                <button
                  className={styles.sourceButton}
                  onClick={() =>
                    confirmSuggestion(
                      "source",
                    )
                  }
                >

                  <strong>
                    {
                      currentSuggestion.sourceColumn
                    }
                  </strong>

                  <span>
                    入力側の値を採用
                  </span>

                </button>

                <button
                  className={styles.rejectButton}
                  onClick={
                    rejectSuggestion
                  }
                >
                  統合しない
                </button>

              </div>

            </div>

          </div>
        )}

    </div>
  );
}

export default App;
