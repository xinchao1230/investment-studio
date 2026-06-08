export interface GroupableChat {
  title?: string | null;
  targetCode?: string | null;
}

export type ChatHistoryTargetNameLookup = (targetCode: string) => string | null | undefined;

export const GLOBAL_CHAT_GROUP = 'global';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractStockCode(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^([A-Z0-9]{1,12}\.(?:SH|SZ|BJ|HK|US|SS))/i);
  return match ? match[1].toUpperCase() : null;
}

export function getChatHistoryGroupKey(chat: GroupableChat): string {
  return extractStockCode(chat.targetCode) ?? extractStockCode(chat.title) ?? GLOBAL_CHAT_GROUP;
}

export function getChatHistoryDisplayTitle(title: string | null | undefined, groupKey: string | null): string {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) return 'Untitled chat';
  if (!groupKey || groupKey === GLOBAL_CHAT_GROUP) return trimmedTitle;

  const prefixPattern = new RegExp(`^${escapeRegExp(groupKey)}[\\s:;,_|/.-]*`, 'i');
  const withoutPrefix = trimmedTitle.replace(prefixPattern, '').trim();
  return withoutPrefix || trimmedTitle;
}

export function getChatHistoryGroupLabel(
  groupKey: string,
  targetNameLookup?: ChatHistoryTargetNameLookup,
): string {
  if (!groupKey || groupKey === GLOBAL_CHAT_GROUP) return 'General';

  const targetName = targetNameLookup?.(groupKey)?.trim();
  if (!targetName || targetName.toUpperCase() === groupKey.toUpperCase()) {
    return groupKey;
  }
  return `${targetName} ${groupKey}`;
}

export function groupChatHistory<T extends GroupableChat>(chats: readonly T[]): Array<{ key: string; chats: T[] }> {
  const groups: Array<{ key: string; chats: T[] }> = [];
  const byKey = new Map<string, { key: string; chats: T[] }>();

  for (const chat of chats) {
    const key = getChatHistoryGroupKey(chat);
    let group = byKey.get(key);
    if (!group) {
      group = { key, chats: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.chats.push(chat);
  }

  return groups;
}
