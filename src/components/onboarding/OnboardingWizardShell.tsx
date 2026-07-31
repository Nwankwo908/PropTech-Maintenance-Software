import { Link } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { primaryPayoutMethodLabel } from '@/api/landlordStripeConnect'
import { OnboardingWelcomeHub } from '@/components/onboarding/OnboardingWelcomeHub'
import { OnboardingStepIndicator } from '@/components/onboarding/OnboardingStepIndicator'
import { OnboardingReviewStep } from '@/components/onboarding/OnboardingReviewStep'
import { OnboardingAiReviewStep } from '@/components/onboarding/OnboardingAiReviewStep'
import { OnboardingDocumentUploadStep } from '@/components/onboarding/OnboardingDocumentUploadStep'
import { OnboardingPayoutsStep } from '@/components/onboarding/OnboardingPayoutsStep'
import { OnboardingApprovalRulesStep } from '@/components/onboarding/OnboardingApprovalRulesStep'
import { OnboardingAccountSetupStep } from '@/components/onboarding/OnboardingAccountSetupStep'
import { OnboardingPropertyStep } from '@/components/onboarding/OnboardingPropertyStep'
import { OnboardingVendorsStep } from '@/components/onboarding/OnboardingVendorsStep'
import { OnboardingResidentsStep } from '@/components/onboarding/OnboardingResidentsStep'
import { OnboardingSetupTransition } from '@/components/onboarding/OnboardingSetupTransition'
import { useOnboardingWizard } from '@/components/onboarding/useOnboardingWizard'

const btnSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

/** Layout shell + step router for landlord onboarding (guided and fast-track). */
export function OnboardingWizardShell() {
  const wizard = useOnboardingWizard()

  if (wizard.loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-[14px] text-[#6a7282]">Loading onboarding…</p>
      </main>
    )
  }

  if (wizard.completingSetup) {
    return <OnboardingSetupTransition />
  }

  if (wizard.importingPortfolio) {
    return (
      <OnboardingSetupTransition
        title="Importing your portfolio"
        subtitle="Creating properties, residents, and vendors…"
      />
    )
  }

  const {
    saving,
    setSaving,
    error,
    setError,
    step,
    state,
    isWelcomeStep,
    isReviewStep,
    isComplete,
    showBackButton,
    editContinueLabel,
    editingFromReview,
    editingFromReviewRef,
    propertyForms,
    setPropertyForms,
    vendorForms,
    setVendorForms,
    residentForms,
    setResidentForms,
    propertyNames,
    unitOptions,
    multiPropertyPortfolio,
    smsConsentAccepted,
    setSmsConsentAccepted,
    smsConsentCheckboxId,
    updateAccountSetup,
    updateApprovalRules,
    uploadDocuments,
    uploadProcessing,
    uploadError,
    extractionReview,
    setExtractionReview,
    queueDocumentUploads,
    removeUploadDocument,
    continueFromDocumentUpload,
    skipDocumentUpload,
    continueFromAiReview,
    reviewData,
    reviewLoading,
    completionCheck,
    payoutsReady,
    setPayoutsReady,
    payoutMethodLabel,
    setPayoutMethodLabel,
    goTo,
    handleStartScratch,
    handleStartFastTrack,
    handleBack,
    refreshCounts,
    returnToReviewAfterEdit,
    continueToApprovalRules,
    saveApprovalRulesAndContinue,
    continueToReview,
    editReviewStep,
    finishReview,
  } = wizard

  const stepSaveDeps = {
    get editingFromReview() {
      return editingFromReviewRef.current
    },
    setSaving,
    setError,
    returnToReviewAfterEdit,
    goTo,
    refreshCounts,
  }

  return (
    <main
      className={
        isWelcomeStep
          ? 'flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10 sm:px-8 sm:py-16'
          : 'flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8'
      }
    >
      <div
        className={
          isWelcomeStep
            ? 'w-full max-w-[880px]'
            : isReviewStep
              ? 'mx-auto w-full max-w-[760px]'
              : 'mx-auto w-full max-w-3xl'
        }
      >
        {!isWelcomeStep && !isReviewStep ? (
          <div className="mb-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[24px] font-semibold tracking-[-0.4px] text-[#101828]">
                {editingFromReview ? 'Edit your setup' : 'Set up Ulo for your portfolio'}
              </h1>
              {isComplete ? (
                <Link to="/admin" className={`${btnSecondary} shrink-0`}>
                  Go to dashboard
                </Link>
              ) : null}
            </div>
            {!editingFromReview ? (
              <OnboardingStepIndicator
                current={step}
                setupPath={state.setupPath}
                className="mb-0 mt-4"
              />
            ) : (
              <p className="mt-2 text-[14px] text-[#6a7282]">
                Update this section, then save to return to your review summary.
              </p>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="sa-enter mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
            {error}
          </div>
        ) : null}

        <div key={step} className={isWelcomeStep ? undefined : 'onb-step-panel'}>
          {step === 'entry' ? (
            <OnboardingWelcomeHub
              onStartScratch={() => void handleStartScratch()}
              onStartFastTrack={() => void handleStartFastTrack()}
            />
          ) : null}

          {step === 'account_setup' ? (
            <OnboardingAccountSetupStep
              accountSetup={state.accountSetup}
              approvalRules={state.approvalRules}
              smsConsentAccepted={smsConsentAccepted}
              setSmsConsentAccepted={setSmsConsentAccepted}
              smsConsentCheckboxId={smsConsentCheckboxId}
              landlordId={state.landlordId}
              updateAccountSetup={updateAccountSetup}
              updateApprovalRules={updateApprovalRules}
              setError={setError}
              saveDeps={{
                ...stepSaveDeps,
                setSmsConsentAccepted,
              }}
              showBackButton={showBackButton}
              saving={saving}
              editContinueLabel={editContinueLabel}
              onBack={() => void handleBack()}
            />
          ) : null}

          {step === 'document_upload' ? (
            <OnboardingDocumentUploadStep
              documents={uploadDocuments}
              processing={uploadProcessing || saving}
              uploadError={uploadError}
              onFilesSelected={queueDocumentUploads}
              onRemoveDocument={removeUploadDocument}
              onBack={() => void handleBack()}
              onContinue={() => void continueFromDocumentUpload()}
              onSkip={() => void skipDocumentUpload()}
            />
          ) : null}

          {step === 'ai_review' && extractionReview ? (
            <OnboardingAiReviewStep
              review={extractionReview}
              saving={saving}
              onReviewChange={setExtractionReview}
              onBackToUploads={() => void goTo('document_upload')}
              onImportAll={() => void continueFromAiReview()}
            />
          ) : null}

          {step === 'property' ? (
            <OnboardingPropertyStep
              propertyForms={propertyForms}
              setPropertyForms={setPropertyForms}
              saveDeps={stepSaveDeps}
              showBackButton={showBackButton}
              saving={saving}
              editContinueLabel={editContinueLabel}
              onBack={() => void handleBack()}
            />
          ) : null}

          {step === 'vendors' ? (
            <OnboardingVendorsStep
              vendorForms={vendorForms}
              setVendorForms={setVendorForms}
              saveDeps={{ ...stepSaveDeps, setVendorForms }}
              showBackButton={showBackButton}
              saving={saving}
              editContinueLabel={editContinueLabel}
              onBack={() => void handleBack()}
            />
          ) : null}

          {step === 'residents' ? (
            <OnboardingResidentsStep
              residentForms={residentForms}
              setResidentForms={setResidentForms}
              saveDeps={{
                properties: state.properties,
                propertyForms,
                ...stepSaveDeps,
                setResidentForms,
                continueToApprovalRules,
              }}
              unitOptions={unitOptions}
              propertyNames={propertyNames}
              multiPropertyPortfolio={multiPropertyPortfolio}
              defaultBuilding={
                state.properties[0]?.name ?? propertyForms[0]?.name.trim() ?? ''
              }
              showBackButton={showBackButton}
              saving={saving}
              editContinueLabel={editContinueLabel}
              onBack={() => void handleBack()}
            />
          ) : null}

          {step === 'approval' ? (
            <OnboardingApprovalRulesStep
              key={JSON.stringify(state.approvalRules)}
              initialRules={state.approvalRules}
              saving={saving}
              showBack={showBackButton}
              showNotificationPreferences={state.setupPath === 'fast_track'}
              continueLabel={editContinueLabel ?? 'Continue'}
              onBack={() => void handleBack()}
              onContinue={(rules) => void saveApprovalRulesAndContinue(rules)}
            />
          ) : null}

          {step === 'payouts' ? (
            <OnboardingPayoutsStep
              landlordId={getActiveLandlordId()}
              saving={saving}
              showBack={showBackButton}
              onBack={() => void handleBack()}
              onContinue={() => {
                if (editingFromReviewRef.current) {
                  void returnToReviewAfterEdit()
                  return
                }
                void continueToReview()
              }}
              onReadyChange={setPayoutsReady}
              onStatusChange={(next) => {
                setPayoutMethodLabel(primaryPayoutMethodLabel(next))
              }}
            />
          ) : null}

          {step === 'review' ? (
            <OnboardingReviewStep
              loading={reviewLoading}
              saving={saving}
              reviewData={reviewData}
              setupPath={state.setupPath}
              completionDisabled={!completionCheck.ok}
              completionMissing={completionCheck.missing}
              payoutsReady={payoutsReady}
              payoutMethodLabel={payoutMethodLabel}
              onEditStep={(targetStep) => void editReviewStep(targetStep)}
              onBack={() => void handleBack()}
              onComplete={() => void finishReview()}
            />
          ) : null}
        </div>
      </div>
    </main>
  )
}
