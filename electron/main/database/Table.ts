import { Connection, Table as LanceDBTable, Query } from "vectordb";
import GetOrCreateLanceTable from "./Lance";
import { DatabaseFields } from "./Schema";
import fs from "fs";
import path from "path";
import {
  EnhancedEmbeddingFunction,
  createEmbeddingFunction,
} from "./Transformers";
import { GetFilesInfoList, flattenFileInfoTree } from "../Files/Filesystem";
import { FileInfo, FileInfoTree } from "../Files/Types";

export interface RagnoteDBEntry {
  notepath: string;
  vector?: Float32Array;
  content: string;
  subnoteindex: number;
  timeadded: Date;
}

export class RagnoteTable {
  // implements Table
  public table!: LanceDBTable<string>;
  public embedFun!: EnhancedEmbeddingFunction<string>;
  // private embeddingModelHFRepo = "Xenova/all-MiniLM-L6-v2";

  async initialize(dbConnection: Connection) {
    this.embedFun = await createEmbeddingFunction(
      "Xenova/bge-base-en-v1.5",
      "content"
    );
    this.table = await GetOrCreateLanceTable(dbConnection, this.embedFun);
  }

  async add(data: RagnoteDBEntry[]): Promise<void> {
    const recordEntry: Record<string, unknown>[] = data as unknown as Record<
      string,
      unknown
    >[];
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < recordEntry.length; i += chunkSize) {
      chunks.push(recordEntry.slice(i, i + chunkSize));
    }
    let index = 0;
    console.log("50th", chunks[1391]);
    // this.
    for (const chunk of chunks) {
      try {
        console.log("index is: ", index);
        await this.table.add(chunk);
      } catch (error) {
        console.error("Error adding chunk to DB:", error);
        // Handle the error as needed, e.g., break the loop, retry, etc.
        // Example: break; // to exit the loop
      }
      index++;
      // break;
    }
  }

  async delete(filter: string): Promise<void> {
    // TODO: maybe make the filter typed as well...
    await this.table.delete(filter);
  }

  async search(
    query: string,
    //   metricType: string,
    limit: number,
    filter?: string
  ): Promise<RagnoteDBEntry[]> {
    const lanceQuery = await this.table
      .search(query)
      // .metricType(metricType)
      .limit(limit);
    if (filter) {
      lanceQuery.filter(filter);
    }
    const rawResults = await lanceQuery.execute();
    const mapped = rawResults.map(convertRawDBResultToRagnoteDBEntry);
    // const filtered = mapped.filter((x) => x !== null);
    return mapped as RagnoteDBEntry[];
    // return rawResults;
  }

  async filter(filterString: string) {
    // const query = new Query("asdf");
    const rawResults = await this.table
      .search("")
      .filter(filterString)
      .execute();
    // query.filter(filterString);
    // const rawResults = await query.execute();
    const mapped = rawResults.map(convertRawDBResultToRagnoteDBEntry);
    // const filtered = mapped.filter((x) => x !== null);
    return mapped as RagnoteDBEntry[];

    // const lanceQuery = await this.table.filter(filterString);
    // const rawResults = await lanceQuery.execute();
    // const mapped = rawResults.map(convertToRagnoteDBEntry);
    // // const filtered = mapped.filter((x) => x !== null);
    // return mapped as RagnoteDBEntry[];
  }

  async countRows(): Promise<number> {
    this.table.countRows;
    return await this.table.countRows();
  }
}

export const maybeRePopulateTable = async (
  table: RagnoteTable,
  directoryPath: string,
  fileExtensions: string[]
) => {
  const count = await table.countRows();
  const filesInfoList = GetFilesInfoList(directoryPath, fileExtensions);
  if (count !== filesInfoList.length) {
    await deleteAllRowsInTable(table);
    await populateDBWithFiles(table, filesInfoList);
  }
};
const deleteAllRowsInTable = async (db: RagnoteTable) => {
  try {
    await db.delete(`${DatabaseFields.CONTENT} != ''`);
    await db.delete(`${DatabaseFields.CONTENT} = ''`);
  } catch (error) {
    console.error("Error deleting rows:", error);
  }
};

const convertTreeToDBEntries = (tree: FileInfoTree): RagnoteDBEntry[] => {
  const flattened = flattenFileInfoTree(tree);
  const entries = flattened.map(convertFileTypeToDBType); // TODO: maybe this can be run async
  return entries;
};

// so we want a function to convert files to dbEntry types (which will involve chunking later on)
const convertFileTypeToDBType = (file: FileInfo): RagnoteDBEntry => {
  return {
    notepath: file.path,
    content: readFile(file.path),
    subnoteindex: 0,
    timeadded: new Date(),
  };
};

export const addTreeToTable = async (
  dbTable: RagnoteTable,
  fileTree: FileInfoTree
): Promise<void> => {
  const dbEntries = convertTreeToDBEntries(fileTree);
  await dbTable.add(dbEntries);
};

export const removeTreeFromTable = async (
  dbTable: RagnoteTable,
  fileTree: FileInfoTree
): Promise<void> => {
  const flattened = flattenFileInfoTree(fileTree);
  const filePaths = flattened.map((x) => x.path);
  for (const filePath of filePaths) {
    await dbTable.delete(`${DatabaseFields.NOTE_PATH} = "${filePath}"`);
  }
};

export const updateNoteInTable = async (
  dbTable: RagnoteTable,
  filePath: string,
  content: string
): Promise<void> => {
  // TODO: maybe convert this to have try catch blocks.
  console.log("deleting from table:");
  await dbTable.delete(`${DatabaseFields.NOTE_PATH} = "${filePath}"`);
  const currentTimestamp: Date = new Date();
  console.log(
    "adding back to table with content and path: ",
    filePath,
    content
  );
  await dbTable.add([
    {
      notepath: filePath,
      content: content,
      subnoteindex: 0,
      timeadded: currentTimestamp,
    },
  ]);
};

const populateDBWithFiles = async (db: RagnoteTable, filesInfo: FileInfo[]) => {
  console.log("filesInfo to populate db with: ", filesInfo);
  const entries: RagnoteDBEntry[] = await Promise.all(
    filesInfo.map(convertFileTypeToDBType)
  );

  await db.add(entries);
};

function readFile(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return data;
  } catch (err) {
    console.error("An error occurred:", err);
    return "";
  }
}

function convertToRecord(entry: RagnoteDBEntry): Record<string, unknown> {
  const recordEntry: Record<string, unknown> = entry as unknown as Record<
    string,
    unknown
  >;
  return recordEntry;
}

function convertRawDBResultToRagnoteDBEntry(
  record: Record<string, unknown>
): RagnoteDBEntry | null {
  if (
    DatabaseFields.NOTE_PATH in record &&
    DatabaseFields.VECTOR in record &&
    DatabaseFields.CONTENT in record &&
    DatabaseFields.SUB_NOTE_INDEX in record &&
    DatabaseFields.TIME_ADDED in record
  ) {
    return record as unknown as RagnoteDBEntry;
  }
  return null;
}