import * as lancedb from "vectordb";
import CreateDatabaseSchema, { isStringifiedSchemaEqual } from "./Schema";
import { EnhancedEmbeddingFunction } from "./Embeddings";

const GetOrCreateLanceTable = async (
  db: lancedb.Connection,
  embedFunc: EnhancedEmbeddingFunction<string>,
  userDirectory: string
): Promise<lancedb.Table<string>> => {
  const allTableNames = await db.tableNames();
  const intendedSchema = CreateDatabaseSchema(embedFunc.contextLength);
  console.log("Intended schema:", intendedSchema);
  const tableName = generateTableName(embedFunc.name, userDirectory);

  if (allTableNames.includes(tableName)) {
    const table = await db.openTable(tableName, embedFunc);
    const schema = await table.schema;
    if (!isStringifiedSchemaEqual(schema, intendedSchema)) {
      await db.dropTable(tableName);
      console.log(`Deleted table ${tableName} due to schema mismatch.`);

      const recreatedTable = await db.createTable({
        name: tableName,
        schema: intendedSchema,
        embeddingFunction: embedFunc,
      });
      console.log(`Recreated table ${tableName} with the intended schema.`);
      return recreatedTable;
    }

    return table;
  }

  const newTable = await db.createTable({
    name: tableName,
    schema: intendedSchema,
    embeddingFunction: embedFunc,
  });
  return newTable;
};

export const generateTableName = (
  embeddingFuncName: string,
  userDirectory: string
): string => {
  const sanitizeForFileSystem = (str: string) => {
    return str.replace(/[<>:"/\\|?*]/g, "_");
  };

  const directoryPathAlias = sanitizeForFileSystem(userDirectory);
  const sanitizedEmbeddingFuncName = sanitizeForFileSystem(embeddingFuncName);

  return `ragnote_table_${sanitizedEmbeddingFuncName}_${directoryPathAlias}`;
};

export default GetOrCreateLanceTable;
