import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  personas,
  personaFiles,
  messages,
  InsertPersona,
  InsertPersonaFile,
  InsertMessage,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// ─── 内存存储（本地开发无数据库时使用）───────────────────────────────────────

interface InMemoryUser {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}

interface InMemoryPersona {
  id: number;
  userId: number;
  name: string;
  avatarUrl: string | null;
  relationshipDesc: string | null;
  togetherFrom: string | null;
  togetherTo: string | null;
  personaData: any;
  analysisStatus: 'pending' | 'analyzing' | 'ready' | 'error';
  analysisProgress: number;
  analysisMessage: string | null;
  emotionalState: 'warm' | 'playful' | 'nostalgic' | 'melancholy' | 'happy' | 'distant';
  chatCount: number;
  lastChatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InMemoryPersonaFile {
  id: number;
  personaId: number;
  userId: number;
  fileType: 'chat_txt' | 'chat_csv' | 'image' | 'video';
  originalName: string;
  fileKey: string;
  fileUrl: string;
  fileSize: number;
  extractedMemory: string | null;
  processStatus: 'uploaded' | 'processing' | 'done' | 'failed';
  createdAt: Date;
}

interface InMemoryMessage {
  id: number;
  personaId: number;
  userId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

// 内存存储
const memoryStore = {
  users: new Map<number, InMemoryUser>(),
  personas: new Map<number, InMemoryPersona>(),
  personaFiles: new Map<number, InMemoryPersonaFile>(),
  messages: new Map<number, InMemoryMessage>(),
  nextUserId: 1,
  nextPersonaId: 1,
  nextFileId: 1,
  nextMessageId: 1,
};

// 初始化本地用户
memoryStore.users.set(1, {
  id: 1,
  openId: 'local-user',
  name: '本地用户',
  email: null,
  loginMethod: null,
  role: 'admin',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
});

// 检查是否使用内存模式
function useMemoryMode(): boolean {
  return !process.env.DATABASE_URL || process.env.DATABASE_URL === '';
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  // 内存模式
  if (useMemoryMode()) {
    const existingUser = Array.from(memoryStore.users.values()).find(
      (u) => u.openId === user.openId
    );
    
    if (existingUser) {
      existingUser.name = user.name ?? existingUser.name;
      existingUser.email = user.email ?? existingUser.email;
      existingUser.loginMethod = user.loginMethod ?? existingUser.loginMethod;
      existingUser.lastSignedIn = new Date();
      if (user.role) existingUser.role = user.role;
      return;
    }
    
    const newUser: InMemoryUser = {
      id: memoryStore.nextUserId++,
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: user.openId === ENV.ownerOpenId ? 'admin' : 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    memoryStore.users.set(newUser.id, newUser);
    return;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  // 内存模式
  if (useMemoryMode()) {
    const user = Array.from(memoryStore.users.values()).find(
      (u) => u.openId === openId
    );
    return user;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Persona helpers ─────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  // 内存模式
  if (useMemoryMode()) {
    const id = memoryStore.nextPersonaId++;
    const now = new Date();
    const persona: InMemoryPersona = {
      id,
      userId: data.userId,
      name: data.name,
      avatarUrl: data.avatarUrl ?? null,
      relationshipDesc: data.relationshipDesc ?? null,
      togetherFrom: data.togetherFrom ?? null,
      togetherTo: data.togetherTo ?? null,
      personaData: null,
      analysisStatus: (data.analysisStatus as any) ?? 'pending',
      analysisProgress: 0,
      analysisMessage: null,
      emotionalState: 'warm',
      chatCount: 0,
      lastChatAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.personas.set(id, persona);
    console.log(`[Memory] Created persona ${id} for user ${data.userId}`);
    return id;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personas).values(data);
  return (result as any).insertId as number;
}

export async function getPersonasByUserId(userId: number) {
  // 内存模式
  if (useMemoryMode()) {
    return Array.from(memoryStore.personas.values())
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // 数据库模式
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personas)
    .where(eq(personas.userId, userId))
    .orderBy(desc(personas.updatedAt));
}

export async function getPersonaById(id: number, userId: number) {
  // 内存模式
  if (useMemoryMode()) {
    const persona = memoryStore.personas.get(id);
    if (persona && persona.userId === userId) {
      return persona;
    }
    return undefined;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updatePersona(
  id: number,
  userId: number,
  data: Partial<InsertPersona>
) {
  // 内存模式
  if (useMemoryMode()) {
    const persona = memoryStore.personas.get(id);
    if (persona && persona.userId === userId) {
      Object.assign(persona, data, { updatedAt: new Date() });
      console.log(`[Memory] Updated persona ${id}`);
      return;
    }
    throw new Error("Persona not found or access denied");
  }

  // 数据库模式
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(personas)
    .set(data)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

export async function deletePersona(id: number, userId: number) {
  // 内存模式
  if (useMemoryMode()) {
    const persona = memoryStore.personas.get(id);
    if (persona && persona.userId === userId) {
      memoryStore.personas.delete(id);
      // 删除相关文件和消息
      for (const [fileId, file] of memoryStore.personaFiles) {
        if (file.personaId === id) {
          memoryStore.personaFiles.delete(fileId);
        }
      }
      for (const [msgId, msg] of memoryStore.messages) {
        if (msg.personaId === id) {
          memoryStore.messages.delete(msgId);
        }
      }
      console.log(`[Memory] Deleted persona ${id}`);
      return;
    }
    throw new Error("Persona not found or access denied");
  }

  // 数据库模式
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .delete(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)));
}

// ─── File helpers ────────────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  // 内存模式
  if (useMemoryMode()) {
    const id = memoryStore.nextFileId++;
    const file: InMemoryPersonaFile = {
      id,
      personaId: data.personaId,
      userId: data.userId,
      fileType: data.fileType as any,
      originalName: data.originalName,
      fileKey: data.fileKey,
      fileUrl: data.fileUrl,
      fileSize: data.fileSize,
      extractedMemory: data.extractedMemory ?? null,
      processStatus: (data.processStatus as any) ?? 'uploaded',
      createdAt: new Date(),
    };
    memoryStore.personaFiles.set(id, file);
    console.log(`[Memory] Created file ${id} for persona ${data.personaId}`);
    return id;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data);
  return (result as any).insertId as number;
}

export async function getFilesByPersonaId(personaId: number) {
  // 内存模式
  if (useMemoryMode()) {
    return Array.from(memoryStore.personaFiles.values())
      .filter((f) => f.personaId === personaId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // 数据库模式
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personaFiles)
    .where(eq(personaFiles.personaId, personaId));
}

// ─── Message helpers ──────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  // 内存模式
  if (useMemoryMode()) {
    const id = memoryStore.nextMessageId++;
    const message: InMemoryMessage = {
      id,
      personaId: data.personaId,
      userId: data.userId,
      role: data.role as any,
      content: data.content,
      createdAt: new Date(),
    };
    memoryStore.messages.set(id, message);
    
    // 更新 persona 的 chatCount 和 lastChatAt
    const persona = memoryStore.personas.get(data.personaId);
    if (persona) {
      persona.chatCount++;
      persona.lastChatAt = new Date();
    }
    
    return id;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(messages).values(data);
  return (result as any).insertId as number;
}

export async function getMessagesByPersonaId(personaId: number, limit: number = 50) {
  // 内存模式
  if (useMemoryMode()) {
    return Array.from(memoryStore.messages.values())
      .filter((m) => m.personaId === personaId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .reverse(); // 返回时间正序
  }

  // 数据库模式
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.personaId, personaId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

export async function clearMessagesByPersonaId(personaId: number) {
  // 内存模式
  if (useMemoryMode()) {
    for (const [msgId, msg] of memoryStore.messages) {
      if (msg.personaId === personaId) {
        memoryStore.messages.delete(msgId);
      }
    }
    return;
  }

  // 数据库模式
  const db = await getDb();
  if (!db) return;
  await db.delete(messages).where(eq(messages.personaId, personaId));
}
