export function validateAihotPayload(url: string, data: unknown) {
  if (!data || typeof data !== 'object') throw new Error('AIHOT 返回的数据格式不正确');
  const value = data as Record<string, unknown>;
  const pathname = url.split('?')[0];
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) invalid('schemaVersion（期望 1）');
  if (pathname === '/api/v1/items') {
    list(value.items, 'items').forEach((item, index) => validateItem(item, `items[${index}]`));
    if (value.page !== undefined) {
      const page = object(value.page, 'page');
      if (typeof page.hasMore !== 'boolean') invalid('page.hasMore');
      if (page.nextCursor !== null && typeof page.nextCursor !== 'string') invalid('page.nextCursor');
    }
  }
  if (pathname === '/api/v1/dailies/latest') {
    const report = object(value.report, 'report');
    if (typeof report.date !== 'string') invalid('report.date');
    list(report.sections, 'report.sections').forEach((section, index) => {
      const prefix = `report.sections[${index}]`;
      const entry = object(section, prefix);
      if (typeof entry.label !== 'string') invalid(`${prefix}.label`);
      list(entry.items, `${prefix}.items`).forEach((item, itemIndex) => validateItem(item, `${prefix}.items[${itemIndex}]`, false));
    });
  }
  const topicList = url === '/api/site/topics';
  const topicDetail = url.startsWith('/api/site/topics/');
  const ranking = url === '/api/site/leaderboard/boards';
  const resets = url === '/api/v1/codex-resets';
  if (topicList || topicDetail) {
    const topics = topicList ? list(value.topics, 'topics') : [value.topic];
    if (topicList) list(value.groups, 'groups').forEach((group, index) => {
      const entry = object(group, `groups[${index}]`);
      for (const key of ['key', 'name', 'blurb']) if (typeof entry[key] !== 'string') invalid(`groups[${index}].${key}`);
    });
    topics.forEach((topic, index) => {
      const prefix = topicList ? `topics[${index}]` : 'topic';
      const entry = object(topic, prefix);
      for (const key of ['slug', 'name', 'group', 'definition']) if (typeof entry[key] !== 'string') invalid(`${prefix}.${key}`);
      for (const key of ['total', 'recent']) if (typeof entry[key] !== 'number') invalid(`${prefix}.${key}`);
    });
    if (topicDetail) list(value.items, 'items').forEach((item, index) => {
      const entry = object(item, `items[${index}]`);
      if (typeof entry.id !== 'string') invalid(`items[${index}].id`);
      if (typeof entry.title !== 'string') invalid(`items[${index}].title`);
      if (typeof object(entry.source, `items[${index}].source`).name !== 'string') invalid(`items[${index}].source.name`);
    });
  }
  if (url === '/api/v1/hot-topics') {
    const items = value.items as Array<Record<string, unknown>>;
    list(items, 'items').forEach((item, index) => validateItem(item, `items[${index}]`));
    if (value.schemaVersion !== 1 || !Array.isArray(items) || value.count !== items.length || items.some((item, index) => {
      if (!item) return true;
      const source = item.source as { name?: unknown } | undefined;
      const links = item.links as { aihot?: unknown; original?: unknown; story?: unknown } | undefined;
      return item.rank !== index + 1 || typeof item.id !== 'string' || typeof item.title !== 'string' ||
        typeof source?.name !== 'string' || typeof links?.aihot !== 'string' || typeof links.original !== 'string' ||
        (links.story !== undefined && typeof links.story !== 'string') ||
        !Number.isInteger(item.sourceCount) || !Number.isInteger(item.signalCount) ||
        (item.participantCount !== undefined && !Number.isInteger(item.participantCount)) ||
        !Array.isArray(item.sourceNames) || item.sourceNames.some((name) => typeof name !== 'string') ||
        typeof item.latestAt !== 'string' || !Number.isFinite(Date.parse(item.latestAt));
    })) throw new Error('热点榜结构发生变化，未覆盖上次有效数据');
  }
  if ((topicList && (!Array.isArray(value.topics) || !Array.isArray(value.groups))) ||
    (topicDetail && (!value.topic || !Array.isArray(value.items) || typeof value.page !== 'number' || typeof value.pageCount !== 'number')) ||
    (ranking && (!Array.isArray(value.boards) || !value.models || !value.run)) ||
    (resets && !Array.isArray(value.events))) throw new Error('AIHOT 数据接口格式发生变化，未覆盖上次有效数据');
  if (ranking) {
    const boards = value.boards as Array<Record<string, unknown>>;
    const run = value.run as { generatedAt?: string; fx?: { rate?: number } };
    if (typeof run.generatedAt !== 'string' || typeof run.fx?.rate !== 'number' || boards.some((board) => !board || !board.board || !Array.isArray(board.entries) || !Array.isArray(board.filterEntries) || !Array.isArray(board.pending))) throw new Error('模型榜结构发生变化，未覆盖上次有效数据');
    for (const board of boards) {
      for (const entry of [...board.entries as Array<Record<string, unknown>>, ...board.filterEntries as Array<Record<string, unknown>>]) {
        const info = (value.models as Record<string, { model?: { name?: string; provider?: string } }>)[String(entry.slug)];
        if (typeof info?.model?.name !== 'string' || typeof info.model.provider !== 'string' || typeof entry.score !== 'number' || typeof entry.coverage !== 'number') throw new Error('模型评分记录不完整，未覆盖上次有效数据');
      }
    }
  }
  if (resets && ((value.today !== undefined && (typeof value.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.today) || !Number.isFinite(Date.parse(value.today)))) || (value.events as Array<Record<string, unknown>>).some((event) => !event || !Array.isArray(event.posts) || !['direct_reset', 'reset_credit'].includes(String(event.type))))) throw new Error('重置监控结构发生变化，未覆盖上次有效数据');
}

function invalid(field: string): never {
  throw new Error(`AIHOT 接口结构发生变化：${field} 缺失或类型不符，未覆盖上次有效数据`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function validateItem(value: unknown, field: string, needsId = true) {
  const item = object(value, field);
  if (needsId && typeof item.id !== 'string') invalid(`${field}.id`);
  if (typeof (item.titleZh || item.title) !== 'string') invalid(`${field}.title`);
  if (typeof item.source !== 'string' && typeof object(item.source, `${field}.source`).name !== 'string') invalid(`${field}.source.name`);
  const links = item.links as { aihot?: unknown; original?: unknown } | undefined;
  if (typeof links?.aihot !== 'string' && typeof item.url !== 'string') invalid(`${field}.links.aihot`);
}
