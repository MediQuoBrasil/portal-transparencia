/**
 * ═══════════════════════════════════════════════════════════
 *  cache.js — Cache persistente com IndexedDB + fallback localStorage
 * ═══════════════════════════════════════════════════════════
 *
 *  Estratégia: stale-while-revalidate.
 *  1. Se existe cache válido (não expirado) → retorna imediatamente.
 *  2. Se existe cache expirado (stale) → retorna imediatamente
 *     E dispara revalidação em background.
 *  3. Se não existe cache → aguarda resposta da rede.
 *
 *  Dados imutáveis (vigências passadas, feriados, relação)
 *  usam TTL longo (24h). Dados voláteis (vigência ativa)
 *  usam TTL curto (5 min).
 */

(function () {
  'use strict';

  // ─── Constantes ────────────────────────────────────────────

  /** @type {string} */
  const DB_NAME = 'mediquo_cache';

  /** @type {number} */
  const DB_VERSION = 1;

  /** @type {string} */
  const STORE_NAME = 'api_cache';

  /**
   * TTLs em milissegundos por tipo de dado.
   * @type {Object<string, number>}
   */
  const TTL = {
    /** Dados que quase nunca mudam: lista de anos, vigências passadas */
    IMUTAVEL: 24 * 60 * 60 * 1000,
    /** Dados que mudam raramente: feriados, relação, alterações */
    ESTAVEL: 2 * 60 * 60 * 1000,
    /** Dados da vigência ativa, teto */
    VOLATIL: 5 * 60 * 1000,
  };

  /**
   * Mapeamento de ações da API para categoria de TTL.
   * @type {Object<string, string>}
   */
  const ACTION_TTL = {
    init_dashboard: 'ESTAVEL',
    listar_anos: 'IMUTAVEL',
    listar_vigencias: 'IMUTAVEL',
    detalhe_vigencia: 'ESTAVEL',
    teto_vigencia: 'ESTAVEL',
    obter_relacao: 'ESTAVEL',
    listar_alteracoes: 'ESTAVEL',
    listar_feriados: 'ESTAVEL',
  };

  /**
   * Ações de escrita que invalidam cache.
   * Cada ação mapeia para os prefixos de cache a invalidar.
   * @type {Object<string, string[]>}
   */
  const INVALIDATION_MAP = {
    upload_vigencia: ['init_dashboard', 'detalhe_vigencia', 'teto_vigencia', 'listar_vigencias'],
    remover_vigencia: ['init_dashboard', 'detalhe_vigencia', 'teto_vigencia', 'listar_vigencias'],
    salvar_relacao: ['init_dashboard', 'obter_relacao', 'teto_vigencia'],
    salvar_relacao_datada: ['init_dashboard', 'obter_relacao', 'listar_alteracoes', 'teto_vigencia'],
    remover_alteracao: ['init_dashboard', 'listar_alteracoes', 'teto_vigencia'],
    salvar_feriados: ['init_dashboard', 'listar_feriados', 'teto_vigencia'],
    adicionar_feriado: ['init_dashboard', 'listar_feriados', 'teto_vigencia'],
    remover_feriado: ['init_dashboard', 'listar_feriados', 'teto_vigencia'],
    criar_ano: ['init_dashboard', 'listar_anos', 'listar_vigencias'],
  };

  // ─── Estado ────────────────────────────────────────────────

  /** @type {IDBDatabase|null} */
  let db = null;

  /** @type {boolean} */
  let dbReady = false;

  /** @type {Promise<void>|null} */
  let dbInitPromise = null;

  // ─── IndexedDB setup ──────────────────────────────────────

  /**
   * Abre ou cria o banco IndexedDB.
   * @returns {Promise<void>}
   */
  const initDB = () => {
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
          const target = /** @type {IDBOpenDBRequest} */ (e.target);
          const database = target.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };

        request.onsuccess = (e) => {
          db = /** @type {IDBOpenDBRequest} */ (e.target).result;
          dbReady = true;
          resolve();
        };

        request.onerror = () => {
          console.warn('[Cache] IndexedDB indisponível, usando localStorage.');
          dbReady = false;
          resolve();
        };
      } catch (_) {
        console.warn('[Cache] IndexedDB não suportado.');
        dbReady = false;
        resolve();
      }
    });

    return dbInitPromise;
  };

  // ─── Operações de cache ───────────────────────────────────

  /**
   * Gera chave de cache a partir da ação e parâmetros.
   *
   * @param {string} action - Nome da ação API.
   * @param {Object} [params={}] - Parâmetros da requisição.
   * @returns {string} Chave única.
   */
  const cacheKey = (action, params = {}) => {
    const relevantParams = { ...params };
    // Remover campos não relevantes para cache
    delete relevantParams.token;
    delete relevantParams.action;

    const paramStr = Object.keys(relevantParams).length > 0
      ? `:${JSON.stringify(relevantParams)}`
      : '';

    return `${action}${paramStr}`;
  };

  /**
   * Obtém TTL em ms para uma ação.
   *
   * @param {string} action - Nome da ação.
   * @returns {number} TTL em milissegundos.
   */
  const getTTL = (action) => {
    const category = ACTION_TTL[action];
    return category ? TTL[category] : 0;
  };

  /**
   * Lê do IndexedDB.
   *
   * @param {string} key - Chave.
   * @returns {Promise<{data: *, timestamp: number}|null>}
   */
  const idbGet = (key) => new Promise((resolve) => {
    if (!dbReady || !db) {
      resolve(null);
      return;
    }

    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };

      request.onerror = () => { resolve(null); };
    } catch (_) {
      resolve(null);
    }
  });

  /**
   * Escreve no IndexedDB.
   *
   * @param {string} key - Chave.
   * @param {*} data - Dados.
   * @returns {Promise<void>}
   */
  const idbSet = (key, data) => new Promise((resolve) => {
    if (!dbReady || !db) {
      resolve();
      return;
    }

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { resolve(); };
    } catch (_) {
      resolve();
    }
  });

  /**
   * Remove do IndexedDB por chave.
   *
   * @param {string} key - Chave.
   * @returns {Promise<void>}
   */
  const idbDelete = (key) => new Promise((resolve) => {
    if (!dbReady || !db) {
      resolve();
      return;
    }

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { resolve(); };
    } catch (_) {
      resolve();
    }
  });

  /**
   * Remove entradas do IDB cujas chaves começam com um prefixo.
   *
   * @param {string} prefix - Prefixo.
   * @returns {Promise<void>}
   */
  const idbDeleteByPrefix = (prefix) => new Promise((resolve) => {
    if (!dbReady || !db) {
      resolve();
      return;
    }

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = (e) => {
        const cursor = /** @type {IDBCursorWithValue} */ (e.target.result);
        if (cursor) {
          if (String(cursor.key).startsWith(prefix)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { resolve(); };
    } catch (_) {
      resolve();
    }
  });

  // ─── Fallback localStorage ────────────────────────────────

  /**
   * Lê do localStorage (fallback).
   *
   * @param {string} key - Chave.
   * @returns {{data: *, timestamp: number}|null}
   */
  const lsGet = (key) => {
    try {
      const raw = localStorage.getItem(`mq_${key}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  /**
   * Escreve no localStorage (fallback).
   *
   * @param {string} key - Chave.
   * @param {*} data - Dados.
   */
  const lsSet = (key, data) => {
    try {
      localStorage.setItem(`mq_${key}`, JSON.stringify({
        data,
        timestamp: Date.now(),
      }));
    } catch (_) {
      // Quota exceeded — limpar cache antigo
      lsClearOldest();
      try {
        localStorage.setItem(`mq_${key}`, JSON.stringify({
          data,
          timestamp: Date.now(),
        }));
      } catch (__) {
        // Dá pra viver sem cache
      }
    }
  };

  /**
   * Remove entradas do localStorage com prefixo.
   *
   * @param {string} prefix - Prefixo da ação.
   */
  const lsDeleteByPrefix = (prefix) => {
    try {
      const fullPrefix = `mq_${prefix}`;
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(fullPrefix)) keys.push(k);
      }
      keys.forEach((k) => { localStorage.removeItem(k); });
    } catch (_) {
      // Silenciar
    }
  };

  /**
   * Remove as 5 entradas mais antigas do localStorage.
   */
  const lsClearOldest = () => {
    try {
      /** @type {Array<{key: string, ts: number}>} */
      const entries = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mq_')) {
          try {
            const parsed = JSON.parse(localStorage.getItem(k) || '{}');
            entries.push({ key: k, ts: parsed.timestamp || 0 });
          } catch (__) {
            entries.push({ key: k, ts: 0 });
          }
        }
      }
      entries.sort((a, b) => a.ts - b.ts);
      entries.slice(0, 5).forEach((e) => { localStorage.removeItem(e.key); });
    } catch (_) {
      // Silenciar
    }
  };

  // ─── API pública ──────────────────────────────────────────

  /**
   * Obtém dados do cache.
   * Retorna { data, stale } onde stale=true indica cache expirado.
   *
   * @param {string} action - Nome da ação API.
   * @param {Object} [params={}] - Parâmetros.
   * @returns {Promise<{data: *, stale: boolean}|null>}
   */
  const get = async (action, params = {}) => {
    const ttl = getTTL(action);
    if (ttl === 0) return null;

    await initDB();

    const key = cacheKey(action, params);

    // Tentar IndexedDB primeiro
    let entry = await idbGet(key);

    // Fallback: localStorage
    if (!entry) {
      entry = lsGet(key);
    }

    if (!entry || !entry.data) return null;

    const age = Date.now() - entry.timestamp;
    const stale = age > ttl;

    return { data: entry.data, stale };
  };

  /**
   * Armazena dados no cache (IDB + localStorage como backup).
   *
   * @param {string} action - Nome da ação API.
   * @param {Object} params - Parâmetros.
   * @param {*} data - Dados a armazenar.
   * @returns {Promise<void>}
   */
  const set = async (action, params, data) => {
    const ttl = getTTL(action);
    if (ttl === 0) return;

    await initDB();

    const key = cacheKey(action, params);

    // Salvar em ambos para redundância
    await idbSet(key, data);
    lsSet(key, data);
  };

  /**
   * Invalida cache relacionado a uma ação de escrita.
   * Chamado automaticamente após operações de mutação.
   *
   * @param {string} action - Ação de escrita que acabou de ocorrer.
   * @returns {Promise<void>}
   */
  const invalidate = async (action) => {
    const prefixes = INVALIDATION_MAP[action];
    if (!prefixes) return;

    await initDB();

    const promises = prefixes.map(async (prefix) => {
      await idbDeleteByPrefix(prefix);
      lsDeleteByPrefix(prefix);
    });

    await Promise.all(promises);
  };

  /**
   * Limpa todo o cache (IDB + localStorage).
   *
   * @returns {Promise<void>}
   */
  const clearAll = async () => {
    await initDB();

    // Limpar IndexedDB
    if (dbReady && db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      } catch (_) {
        // Silenciar
      }
    }

    // Limpar localStorage (somente chaves do app)
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mq_')) keys.push(k);
      }
      keys.forEach((k) => { localStorage.removeItem(k); });
    } catch (_) {
      // Silenciar
    }
  };

  /**
   * Verifica se uma ação é cacheável.
   *
   * @param {string} action - Nome da ação.
   * @returns {boolean}
   */
  const isCacheable = (action) => Boolean(ACTION_TTL[action]);

  // Iniciar DB no boot (não bloqueia)
  initDB();

  window.Cache = {
    get,
    set,
    invalidate,
    clearAll,
    isCacheable,
  };
})();
