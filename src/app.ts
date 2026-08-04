import express from 'express';
import cors from 'cors';
import routes from './routes/v1/index.js';
import { errorConverter, errorHandler } from './middlewares/error.js';
import { ApiError } from './utils/ApiError.js';

const app = express();

app.use(express.json());

// origin:true reflects the request's actual Origin header back (instead of
// the previous bare wildcard '*') and credentials:true sends
// Access-Control-Allow-Credentials — browsers reject a wildcard origin
// outright whenever the request is made with credentials (cookies /
// `withCredentials`/`credentials:'include'`), which is a common default in
// frontend HTTP clients even when not strictly needed. Reflecting the
// origin is a strict superset of the old behavior for any non-credentialed
// request, so nothing that worked before stops working.
app.use(cors({ origin: true, credentials: true }));

app.use('/v1', routes);

app.use((req, res, next) => {
  next(new ApiError(404, 'Endpoint not found.'));
});

app.use(errorConverter);

app.use(errorHandler);

export default app;
