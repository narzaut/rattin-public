import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import MovieCard from "../components/MovieCard";
import { searchTMDB } from "../lib/api";
import "./Search.css";

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any[] | null>(null);

  useEffect(() => {
    if (!q) { setResults([]); return; }
    setResults(null);
    searchTMDB(q).then((data) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setResults((data.results || []).filter((r: any) => r.media_type === "movie" || r.media_type === "tv"));
    }).catch(() => setResults([]));
  }, [q]);

  return (
    <div className="search-page">
      <h1>Results for &ldquo;{q}&rdquo;</h1>
      {results === null ? (
        <div className="search-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="movie-card"><div className="movie-card-poster skeleton" /></div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <p className="search-empty">No results found</p>
      ) : (
        <div className="search-grid">
          {results.map((item) => <MovieCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
