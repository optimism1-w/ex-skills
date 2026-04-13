import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // 本地开发模式：如果没有 OAuth 配置，创建本地用户
  if (!ENV.oAuthServerUrl || ENV.oAuthServerUrl === "") {
    const isLocalhost = opts.req.hostname === 'localhost' || 
                        opts.req.hostname === '127.0.0.1' ||
                        opts.req.headers.host?.includes('localhost') ||
                        opts.req.headers.host?.includes('127.0.0.1');
    
    if (isLocalhost || !ENV.isProduction) {
      user = {
        id: 1,
        openId: 'local-user',
        name: '本地用户',
        email: null,
        loginMethod: null,
        role: 'admin',
        lastSignedIn: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User;
      
      return {
        req: opts.req,
        res: opts.res,
        user,
      };
    }
  }

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}