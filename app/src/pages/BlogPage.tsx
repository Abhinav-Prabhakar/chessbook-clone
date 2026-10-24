import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { ContentLayout } from "./OpeningsPage";

export interface BlogPost {
  id: number;
  slug: string;
  title: string;
  publishedAt: string;
  excerpt: string;
  sortOrder: number;
  source: string;
}

interface BlogResponse {
  posts: BlogPost[];
  total: number;
  available: boolean;
  source: string;
}

export const formatPostDate = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

/** Renders the tiny amount of markdown present in the captured excerpts. */
export function InlineText({ text }: { text: string }) {
  const tokens = text.split(/(\[[^\]]+\]\([^)]+\)|_[^_]+_)/g).filter((token) => token !== "");
  return (
    <>
      {tokens.map((token, index) => {
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const href = link[2].startsWith("/")
            ? `https://chessbook.com${link[2]}`
            : link[2];
          return (
            <a href={href} key={`${token}-${index}`} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        }
        if (/^_[^_]+_$/.test(token)) {
          return <em key={`${token}-${index}`}>{token.slice(1, -1)}</em>;
        }
        return <span key={`${token}-${index}`}>{token}</span>;
      })}
    </>
  );
}

export function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get<BlogResponse>("/blog")
      .then((response) => {
        if (!alive) return;
        setPosts(response.posts);
        setError(response.available ? "" : "The captured blog has no posts.");
      })
      .catch((requestError: Error) => {
        if (!alive) return;
        setPosts([]);
        setError(requestError.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ContentLayout crumbs={[{ label: "Blog" }]}>
      <h1 className="cb-cs-title">Chessbook blog</h1>
      <p className="cb-cs-lede">
        Posts about building Chessbook, the Chessbook-1 human-like chess engine, chess data and
        training. Dates and excerpts are the captured production content. Most recent first.
      </p>

      {posts === null ? (
        <SkeletonRows rows={6} />
      ) : error || posts.length === 0 ? (
        <EmptyState icon="fa-newspaper" title="Blog unavailable">
          {error || "The captured blog contains no posts."}
        </EmptyState>
      ) : (
        <div className="cb-cs-posts">
          {posts.map((post) => (
            <Link className="cb-cs-post" to={`/blog/${post.slug}`} key={post.slug}>
              <h2>{post.title}</h2>
              <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
              <p>
                <InlineText text={post.excerpt} />
              </p>
              <span className="cb-cs-read">Read more</span>
            </Link>
          ))}
        </div>
      )}

      <p className="cb-cs-note">
        <i className="fa fa-circle-info" aria-hidden />
        <span>
          The capture contains the post titles, dates and excerpts. Full article bodies were not
          included; each post page states that explicitly instead of inventing the missing text.
        </span>
      </p>
    </ContentLayout>
  );
}
