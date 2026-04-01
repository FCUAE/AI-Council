export default function Privacy() {
  return (
    <div className="flex-1 flex flex-col items-center px-4 py-12 max-w-3xl mx-auto" data-testid="page-privacy">
      <h1 className="text-2xl font-bold text-[#1a1a1a] mb-6" data-testid="text-privacy-title">Privacy Policy</h1>
      <div className="prose prose-sm text-[#4a4a4a] space-y-4 w-full">
        <p>
          Your privacy is important to us. This page outlines how AI Council collects,
          uses, and protects your information.
        </p>
        <h2 className="text-lg font-semibold text-[#1a1a1a]">Information We Collect</h2>
        <p>
          We collect information you provide when creating an account, such as your
          name and email address. We also collect conversation data you submit to the
          platform in order to provide the AI debate service.
        </p>
        <h2 className="text-lg font-semibold text-[#1a1a1a]">How We Use Your Information</h2>
        <p>
          Your information is used to operate the service, process payments, and
          improve the user experience. We do not sell your personal data to third
          parties.
        </p>
        <h2 className="text-lg font-semibold text-[#1a1a1a]">Data Retention</h2>
        <p>
          We retain your data for as long as your account is active or as needed to
          provide the service. You may request deletion of your data by contacting
          support.
        </p>
        <h2 className="text-lg font-semibold text-[#1a1a1a]">Contact</h2>
        <p>
          If you have questions about this privacy policy, please contact us at{" "}
          <a href="mailto:support@askaicouncil.com" className="text-[#4f46e5] underline" data-testid="link-support-email">
            support@askaicouncil.com
          </a>.
        </p>
        <p className="text-xs text-[#999] mt-8">
          This is a placeholder privacy policy. A comprehensive policy will be published soon.
        </p>
      </div>
    </div>
  );
}
