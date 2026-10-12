import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { createEStampRequestSchema } from "../../schemas/estampRequest.schema";
import { apiClient } from "../../api/client";
import { formatCurrency, errorMessage } from "../../utils/format";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";

const STEPS = ["Basic Details", "State & Article", "Financial Details", "Calculation", "Review & Submit"];

// Fields validated (via handleSubmit-style trigger) before each step can
// advance. Mirrors createEStampRequestSchema's exact field set - split
// across steps, nothing added or removed.
const STEP_FIELDS = [
  ["firstParty", "secondParty", "descriptionOfDocument", "propertyDescription"],
  ["stateCode", "articleId"],
  ["considerationPrice", "stampDutyPaidBy", "numberOfEStamps"],
  [],
  [],
];

// The exact set of input values a fetched calculation was computed from -
// if any of these change, the calculation is stale and must not be usable
// for submission until it is refreshed. This is the single most
// safety-critical piece of the wizard: it is what stops the frontend from
// ever submitting against a calculation that no longer matches the form.
function calcKey({ stateCode, articleId, considerationPrice, numberOfEStamps }) {
  return JSON.stringify([stateCode, articleId, considerationPrice, numberOfEStamps]);
}

export default function NewRequestPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // /wallet is only reachable with WALLET_VIEW (Super Admin); others are told who can add funds.
  const canOpenWallet = hasPermission(user, PERMISSIONS.WALLET_VIEW);
  const [step, setStep] = useState(0);
  const [lookupError, setLookupError] = useState(null);
  const [states, setStates] = useState([]);
  const [articles, setArticles] = useState([]);
  const [balance, setBalance] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [calculation, setCalculation] = useState(null);
  const [calculatedForKey, setCalculatedForKey] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState(null);

  // Generated once per visit and resent unchanged on every submit attempt
  // (including retries) - the backend recognizes this to avoid a duplicate
  // charge/request on accidental resubmission. Do not regenerate per step.
  const [idempotencyKey] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createEStampRequestSchema),
    mode: "onChange",
    defaultValues: { numberOfEStamps: 1 },
  });

  const values = watch();
  const currentKey = useMemo(() => calcKey(values), [values.stateCode, values.articleId, values.considerationPrice, values.numberOfEStamps]);
  const isFresh = calculation !== null && calculatedForKey === currentKey;

  useEffect(() => {
    // Available = balance minus amounts reserved by requests still in their window.
    apiClient
      .get("/wallet/balance")
      .then((res) => setBalance(res.data.data.availableBalance ?? res.data.data.balance))
      .catch(() => setBalance(null));
    apiClient
      .get("/articles/states")
      .then((res) => setStates(res.data.data))
      .catch((err) => {
        setStates([]);
        setLookupError(errorMessage(err, "Could not load states. Refresh the page to try again."));
      });
  }, []);

  useEffect(() => {
    if (!values.stateCode) {
      setArticles([]);
      return;
    }
    apiClient
      .get("/articles", { params: { stateCode: values.stateCode } })
      .then((res) => {
        const payload = res.data.data;
        setArticles(Array.isArray(payload) ? payload : payload?.items || []);
      })
      .catch((err) => {
        setArticles([]);
        setLookupError(errorMessage(err, "Could not load articles for this state."));
      });
  }, [values.stateCode]);

  async function goNext() {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await trigger(fields);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function runCalculation() {
    setCalcError(null);
    setCalculating(true);
    try {
      const { data } = await apiClient.post("/estamps/calculate", {
        stateCode: values.stateCode,
        articleId: values.articleId,
        considerationPrice: values.considerationPrice || 0,
        numberOfEStamps: values.numberOfEStamps || 1,
      });
      setCalculation(data.data);
      setCalculatedForKey(calcKey(values));
    } catch (err) {
      setCalcError(errorMessage(err, "Unable to calculate stamp duty."));
      setCalculation(null);
      setCalculatedForKey(null);
    } finally {
      setCalculating(false);
    }
  }

  async function onSubmit(formValues) {
    setServerError(null);
    if (!isFresh) {
      setServerError("Please recalculate before submitting - the entered details have changed since the last calculation.");
      setStep(3);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await apiClient.post("/estamps", { ...formValues, idempotencyKey });
      const { request } = data.data;
      navigate(`/estamps/requests/${request._id}`, {
        replace: true,
        state: { notice: `Request ${request.requestNumber} created. ${formatCurrency(request.calculatedStampDuty)} is reserved from your available balance and charged when the 20-minute window ends. Cancel within the window and nothing is charged.` },
      });
    } catch (err) {
      setServerError(errorMessage(err, "Failed to create request"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl pb-24">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Create E-Stamp Request</h1>
        {balance !== null && (
          <div className="text-sm text-slate-500">
            Available balance: <span className="font-semibold text-slate-900">{formatCurrency(balance)}</span>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Need to create many at once?{" "}
        <Link to="/estamps/bulk" className="text-brand-600 hover:underline">
          Use Bulk E-Stamp
        </Link>
        .
      </p>

      <Stepper step={step} />

      {serverError && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{serverError}</div>}
      {lookupError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {lookupError}
        </div>
      )}
      {balance === 0 && !serverError && (
        <div className="mb-4 rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
          Your organization's available balance is ₹0. This request will be rejected unless funds are added first. <AddFundsHint canOpenWallet={canOpenWallet} />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First Party" error={errors.firstParty?.message}>
                <input className="input" {...register("firstParty")} />
              </Field>
              <Field label="Second Party" error={errors.secondParty?.message}>
                <input className="input" {...register("secondParty")} />
              </Field>
            </div>
            <Field label="Description of Document" error={errors.descriptionOfDocument?.message}>
              <textarea className="input" rows={2} {...register("descriptionOfDocument")} />
            </Field>
            <Field label="Property Description">
              <textarea className="input" rows={2} {...register("propertyDescription")} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="State" error={errors.stateCode?.message}>
              <select
                className="input"
                value={values.stateCode || ""}
                onChange={(e) => {
                  setValue("stateCode", e.target.value, { shouldValidate: true });
                  setValue("articleId", "", { shouldValidate: false });
                }}
              >
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Article" error={errors.articleId?.message}>
              <select className="input" {...register("articleId")} disabled={!values.stateCode}>
                <option value="">Select article</option>
                {articles.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.articleCode} - {a.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Consideration Price (₹)" error={errors.considerationPrice?.message}>
              <input type="number" className="input" {...register("considerationPrice", { valueAsNumber: true })} />
            </Field>
            <Field label="Who pays the stamp duty?" error={errors.stampDutyPaidBy?.message}>
              {values.firstParty || values.secondParty ? (
                <div className="flex gap-2">
                  {values.firstParty && (
                    <button
                      type="button"
                      onClick={() => setValue("stampDutyPaidBy", values.firstParty, { shouldValidate: true })}
                      className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                        values.stampDutyPaidBy === values.firstParty
                          ? "border-brand-600 bg-brand-50 text-brand-700 font-medium"
                          : "border-slate-300 text-slate-600"
                      }`}
                    >
                      {values.firstParty} (First Party)
                    </button>
                  )}
                  {values.secondParty && (
                    <button
                      type="button"
                      onClick={() => setValue("stampDutyPaidBy", values.secondParty, { shouldValidate: true })}
                      className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                        values.stampDutyPaidBy === values.secondParty
                          ? "border-brand-600 bg-brand-50 text-brand-700 font-medium"
                          : "border-slate-300 text-slate-600"
                      }`}
                    >
                      {values.secondParty} (Second Party)
                    </button>
                  )}
                </div>
              ) : (
                <input className="input" {...register("stampDutyPaidBy")} placeholder="Enter party names on the previous step first" />
              )}
            </Field>
            <Field label="No. of E-Stamps" error={errors.numberOfEStamps?.message}>
              <input type="number" className="input" {...register("numberOfEStamps", { valueAsNumber: true })} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This calculation is a live preview from the backend's rules for the selected state and article. It does not reserve any
              balance - the final amount is independently recalculated on submission.
            </p>
            <button type="button" onClick={runCalculation} disabled={calculating} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {calculating ? "Calculating..." : calculation ? "Recalculate" : "Calculate Stamp Duty"}
            </button>
            {calcError && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{calcError}</div>}
            {calculation && (
              <div className={`rounded-lg border px-4 py-3 text-sm ${isFresh ? "bg-slate-50 border-slate-200" : "bg-amber-50 border-amber-200"}`}>
                <p className="text-slate-500 mb-1">Estimated stamp duty:</p>
                <p className="text-lg font-semibold text-slate-900">{formatCurrency(calculation.amount)}</p>
                {!isFresh && (
                  <p className="text-amber-700 mt-2">
                    The details have changed since this was calculated. Please recalculate before continuing.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <ReviewStep values={values} calculation={isFresh ? calculation : null} balance={balance} canOpenWallet={canOpenWallet} />
        )}

        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="text-sm text-slate-600 border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            // Distinct `key`s (rather than letting the ternary swap
            // type="button"/type="submit" on the SAME reused DOM node) -
            // without this, React reconciles both branches to one physical
            // <button> element in this slot, and a click that flips
            // type="button" -> type="submit" mid-event can have the browser's
            // native form-submission activation behavior run against the
            // now-mutated node, silently submitting the form on what the
            // user saw as a "Next" click (caught via real-browser QA, not by
            // the build or unit tests).
            <button key="next-btn" type="button" onClick={goNext} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
              Next
            </button>
          ) : (
            <button
              key="submit-btn"
              type="submit"
              disabled={submitting || !isFresh || (typeof balance === "number" && calculation && balance < calculation.amount)}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Create Request"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 mb-4 text-xs">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`rounded-full px-3 py-1 font-medium ${
            i === step ? "bg-brand-600 text-white" : i < step ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function AddFundsHint({ canOpenWallet }) {
  return canOpenWallet ? (
    <span>
      <Link to="/wallet" className="font-medium underline">
        Add money to the wallet
      </Link>{" "}
      (payments are added to your balance once LauncherDesk confirms them, see{" "}
      <Link to="/payments" className="font-medium underline">
        Payments
      </Link>
      ).
    </span>
  ) : (
    <span>Ask your Super Admin to add funds.</span>
  );
}

function ReviewStep({ values, calculation, balance, canOpenWallet }) {
  const insufficientBalance = calculation && typeof balance === "number" && balance < calculation.amount;
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <Row label="First Party" value={values.firstParty} />
        <Row label="Second Party" value={values.secondParty} />
        <Row label="Description" value={values.descriptionOfDocument} />
        <Row label="Property Description" value={values.propertyDescription || "-"} />
        <Row label="State" value={values.stateCode} />
        <Row label="Consideration Price" value={formatCurrency(values.considerationPrice)} />
        <Row label="Stamp Duty Paid By" value={values.stampDutyPaidBy} />
        <Row label="No. of E-Stamps" value={values.numberOfEStamps} />
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
        {calculation ? (
          <>
            <Row label="Stamp Duty to be Reserved" value={formatCurrency(calculation.amount)} />
            <Row label="Available Balance" value={formatCurrency(balance)} />
            <p className="text-xs text-slate-500 pt-1">The amount is reserved when you submit and charged when the 20-minute window ends.</p>
          </>
        ) : (
          <p className="text-amber-700">Go back to the Calculation step and recalculate before submitting.</p>
        )}
      </div>

      {insufficientBalance && (
        <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2">
          Insufficient balance: this request needs {formatCurrency(calculation.amount)} but the available balance is {formatCurrency(balance)}.{" "}
          <AddFundsHint canOpenWallet={canOpenWallet} />
        </div>
      )}
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
