"use client";

import { useActionState, startTransition, type FormEvent } from "react";
import type { ActionResult } from "@/lib/action-result";

/**
 * Wraps a server action for a <form onSubmit>. Unlike <form action>, it does
 * NOT clear the form afterwards, so people don't retype everything after a
 * validation error on a slow phone.
 */
export function useFormAction<T = undefined>(
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>,
) {
  const [state, dispatch, pending] = useActionState(action, null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const fieldError = (name: string) =>
    state && !state.ok ? state.fieldErrors?.[name] : undefined;
  const formError =
    state && !state.ok && !state.fieldErrors ? state.error : undefined;

  return { state, pending, onSubmit, fieldError, formError };
}
