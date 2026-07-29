export default function Loading() {
  return (
    <div className="container py-8">
      <div className="space-y-4">
        <div className="h-10 w-1/3 bg-muted rounded animate-pulse" />
        <div className="h-64 w-full bg-muted/40 rounded animate-pulse" />
      </div>
    </div>
  );
}
