export declare class RouterOSClient {
  constructor(host: string, port?: number);
  connect(): Promise<void>;
  login(username: string, password: string): Promise<any>;
  runQuery<T = any>(
    cmd: string,
    params?: Record<string, string | number | boolean>
  ): Promise<T[]>;
  close(): void;
}

export default RouterOSClient;
