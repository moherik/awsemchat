import type { FriendList } from './friends-flow.ts';
export function selectFriends(list: FriendList, query: string) {
  const search = query.trim().toUpperCase();
  const items = list.items.filter(item => item.pin.includes(search));
  const state = list.items.length ? (items.length ? 'content' : 'no-results') : list.phase === 'ready' ? 'empty' : list.phase === 'error' ? 'error' : 'loading';
  return { items, state, canLoadMore: !!list.nextCursor && !list.refreshing && list.phase === 'ready' };
}
