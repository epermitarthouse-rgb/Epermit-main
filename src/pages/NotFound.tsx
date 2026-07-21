import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="pilot-kicker mb-2">Error</p>
        <h1 className="font-tight text-4xl font-black tracking-tight text-foreground">404</h1>
        <p className="mt-3 text-muted-foreground">Page not found. Unknown URLs stay on this screen (no silent dashboard redirect).</p>
        <Link to="/" className="mt-6 inline-flex font-tight text-sm font-semibold text-primary hover:underline">
          Return to Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
