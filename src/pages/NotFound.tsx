import { Link, useLocation } from 'react-router-dom';

const NotFound = () => {
  const location = useLocation();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="text-center">
        <h1 className="mb-2 text-4xl font-bold">404</h1>
        <p className="mb-1 text-xl text-muted-foreground">Nothing here</p>
        <p className="mb-6 font-mono text-xs text-muted-foreground">{location.pathname}</p>
        <Link to="/" className="text-primary underline underline-offset-4 hover:text-primary/90">
          Back to your library
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
