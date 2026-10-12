export function filterModels(ids: string[], query: string) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return ids.filter(id => terms.every(term => id.toLowerCase().includes(term)));
}
