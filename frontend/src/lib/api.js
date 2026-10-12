import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL?.replace(/\/+$/, "")}/api/v1`,
  withCredentials: true,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(async (config) => {
  const method = (config.method || "get").toLowerCase();

  if (!["get", "head", "options"].includes(method)) {
    // Use plain axios so fetching the CSRF token does not
    // trigger this interceptor recursively.
    const response = await axios.get(
      `${api.defaults.baseURL}/auth/csrf`,
      {
        withCredentials: true,
        timeout: 20000,
      }
    );

    const csrfToken = response.data?.csrf_token;

    if (!csrfToken) {
      throw new Error(
        "Unable to obtain the CSRF security token."
      );
    }

    config.headers = config.headers || {};

    if (typeof config.headers.set === "function") {
      config.headers.set(
        "X-CSRF-Token",
        csrfToken
      );
    } else {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }

  return config;
});

export function errMsg(error) {
  const err = error?.response?.data?.error;

  if (!err) {
    if (error?.response) {
      return (
        error.response.data?.detail ||
        "Request failed."
      );
    }

    return (
      error?.message ||
      "Network error: the server could not be reached."
    );
  }

  if (
    Array.isArray(err.details) &&
    err.details.length
  ) {
    return `${err.message} ${err.details
      .map((detail) =>
        detail.field
          ? `${detail.field}: ${detail.msg}`
          : detail.msg
      )
      .join(" ")}`;
  }

  return (
    err.message ||
    "An unexpected error occurred."
  );
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

  const pad = (number) =>
    String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};
