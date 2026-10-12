import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL?.replace(/\/+$/, "")}/api/v1`,
  withCredentials: true,
  timeout: 20000,
});

// Keep the session-bound CSRF token in memory.
let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

// These endpoints must work without an existing authenticated session.
const csrfExemptPaths = [
  "/auth/login",
  "/auth/mfa/login",
  "/auth/reset-password",
  "/students/register",
];

api.interceptors.request.use(async (config) => {
  const method = (config.method || "get").toLowerCase();

  const path = (config.url || "")
    .split("?")[0]
    .replace(/\/+$/, "");

  // Safe HTTP methods do not require a CSRF header.
  if (["get", "head", "options"].includes(method)) {
    return config;
  }

  // Public endpoints must not request a session-bound CSRF token.
  if (csrfExemptPaths.includes(path)) {
    return config;
  }

  // Fetch a CSRF token when a protected write request needs one.
  if (!csrfToken) {
    const response = await axios.get(
      `${api.defaults.baseURL}/auth/csrf`,
      {
        withCredentials: true,
        timeout: 20000,
      }
    );

    csrfToken = response.data?.csrf_token || null;
  }

  if (!csrfToken) {
    throw new Error(
      "Unable to obtain the CSRF security token. Please sign in again."
    );
  }

  config.headers = config.headers || {};

  if (typeof config.headers.set === "function") {
    config.headers.set("X-CSRF-Token", csrfToken);
  } else {
    config.headers["X-CSRF-Token"] = csrfToken;
  }

  return config;
});

export function errMsg(error) {
  const err = error?.response?.data?.error;

  if (!err) {
    if (error?.response) {
      return error.response.data?.detail || "Request failed.";
    }

    return (
      error?.message ||
      "Network error: the server could not be reached."
    );
  }

  if (Array.isArray(err.details) && err.details.length) {
    return `${err.message} ${err.details
      .map((detail) =>
        detail.field
          ? `${detail.field}: ${detail.msg}`
          : detail.msg
      )
      .join(" ")}`;
  }

  return err.message || "An unexpected error occurred.";
}

export const errCode = (error) =>
  error?.response?.data?.error?.code;

export const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const toLocalInput = (iso) => {
  if (!iso) return "";

  const date = new Date(iso);
  const pad = (number) => String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};
