using System.Runtime.CompilerServices;
using Amazon.XRay.Recorder.Handlers.AwsSdk;

namespace VoiceAgent;

// Registers X-Ray instrumentation for all AWS SDK clients (Bedrock, ...) constructed
// anywhere in this assembly. Must run before any such client is created — a module
// initializer runs before any type in the assembly is first touched.
internal static class XRayInit
{
    [ModuleInitializer]
    internal static void Register() => AWSSDKHandler.RegisterXRayForAllServices();
}
