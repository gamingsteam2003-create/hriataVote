import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL?.replace(/\/+$/, "")}/api/v1`,
  withCredentials: true,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
  },
});

const readCookie = (name) => {
  const prefix = `${name}=`;

  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));

  if (!cookie) return null;

  const value = cookie.slice(prefix.length);

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();

  if (!["get", "head", "options"].includes(method)) {
    const csrfToken = readCookie("vs_csrf");

    // Diagnostic only: never print the actual token.
    console.log("CSRF cookie available:", Boolean(csrfToken));

    config.headers = config.headers || {};

    if (csrfToken) {
      if (typeof config.headers.set === "function") {
        config.headers.set("X-CSRF-Token", csrfToken);
      } else {
        config.headers["X-CSRF-Token"] = csrfToken;
      }
    } else {
      console.warn("CSRF cookie is not readable by the frontend.");
    }
  }

  return config;
});

export function errMsg(error) {
  const err = error?.response?.data?.error;

  if (!err) {
    if (error?.response) {
      return error.response.data?.detail || "Request failed.";
    }

    return "Network error: the server could not be reached.";
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
