import axios from "axios";
export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api/v1`,
  withCredentials: true,
  timeout: 20000,
});
const readCookie = (name) => {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
};
api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (!["get", "head", "options"].includes(method)) {
    const csrfToken = readCookie("vs_csrf");
    if (csrfToken) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});
export function errMsg(error) {
  const err = error?.response?.data?.error;
  if (!err) {
    return error?.response
      ? "Request failed."
      : "Network error: the server could not be reached.";
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
