package audience

// Recipients preserves the source audience while excluding departed members.
func Recipients(original, current []string) []string {
	members := make(map[string]struct{}, len(current))
	for _, id := range current {
		members[id] = struct{}{}
	}
	seen := make(map[string]struct{}, len(original))
	result := make([]string, 0, len(original))
	for _, id := range original {
		if _, allowed := members[id]; !allowed {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		result = append(result, id)
		seen[id] = struct{}{}
	}
	return result
}
