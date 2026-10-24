import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui";
import { ContentLayout } from "./OpeningsPage";
import { InlineText, formatPostDate, type BlogPost } from "./BlogPage";

interface PostResponse {
  post: BlogPost;
  bodyAvailable: boolean;
}

export function BlogPostPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [bodyAvailable, setBodyAvailable] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setPost(null);
    setError("");
    api
      .get<PostResponse>(`/blog/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (!alive) return;
        setPost(response.post);
        setBodyAvailable(response.bodyAvailable);
      })
      .catch((requestError: Error) => {
        if (alive) setError(requestError.message);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) {
    return (
      <ContentLayout crumbs={[{ label: "Blog", to: "/blog" }, { label: "Not found" }]}>
        <EmptyState
          icon="fa-newspaper"
          title="Post not found"
          action={
            <Link className="cb-btn primary" to="/blog">
              Back to the blog
            </Link>
          }
        >
          {error}
        </EmptyState>
      </ContentLayout>
    );
  }

  if (!post) {
    return (
      <ContentLayout crumbs={[{ label: "Blog", to: "/blog" }, { label: "Loading…" }]}>
        <SkeletonRows rows={6} />
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      crumbs={[{ label: "Blog", to: "/blog" }, { label: post.title }]}
      narrow
    >
      <article>
        <h1 className="cb-cs-title" style={{ fontSize: "clamp(32px,4vw,48px)" }}>
          {post.title}
        </h1>
        <p className="cb-row-meta" style={{ margin: "0 0 26px" }}>
          Chessbook · <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
        </p>

        <div className="cb-cs-prose">
          <p style={{ color: "var(--cb-text-2)", fontSize: 17 }}>
            <InlineText text={post.excerpt} />
          </p>
          {!bodyAvailable && (
            <>
              <div className="cb-cs-note">
                <i className="fa fa-circle-info" aria-hidden />
                <span>
                  This local build captured the post's title, date and excerpt. The full article
                  body was not part of the capture, so it is not shown rather than inventing text.
                </span>
              </div>
              <p>
                The complete article is published on Chessbook. The blog index lists the rest of
                the captured posts, and the in-app Help page links to the public Chessbook wiki.
              </p>
            </>
          )}
        </div>

        <div className="cb-cs-actions" style={{ marginTop: 26 }}>
          <Link className="cb-btn" to="/blog">
            All posts
          </Link>
          <Link className="cb-link" to="/help">
            Help and documentation
          </Link>
        </div>
      </article>
    </ContentLayout>
  );
}
