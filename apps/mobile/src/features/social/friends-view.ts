import type { FriendList } from './friends-flow.ts';
export function selectFriends(list: FriendList, query: string, profileTerms: (item: FriendList['items'][number]) => readonly string[] = () => []) {
  const search = query.trim().toLowerCase();
  const items = list.items.filter(item => item.pin.toLowerCase().includes(search) || profileTerms(item).some(term => term.toLowerCase().includes(search)));
  const state = list.items.length ? (items.length ? 'content' : 'no-results') : list.phase === 'ready' ? 'empty' : list.phase === 'error' ? 'error' : 'loading';
  return { items, state, canLoadMore: !!list.nextCursor && !list.refreshing && list.phase === 'ready' };
}
