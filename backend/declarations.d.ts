declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    run(params?: any[]): void;
    get(params?: any[]): any[];
    all(params?: any[]): any[];
    asArray(params?: any[]): any[];
    free(): boolean;
    bind(params?: any[]): boolean;
    step(): boolean;
    reset(): void;
    finalize(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  function initSqlJs(): Promise<SqlJsStatic>;
  export default initSqlJs;
  export { SqlJsStatic, Database, Statement, QueryExecResult };
}

declare module 'multer' {
  import { Request } from 'express';
  
  interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  interface Multer {
    single(fieldname: string): (req: Request, res: any, next: (err?: any) => void) => void;
    array(fieldname: string, maxCount?: number): (req: Request, res: any, next: (err?: any) => void) => void;
  }

  function multer(options?: any): Multer;
  export default multer;
  export { MulterFile, Multer };
}
