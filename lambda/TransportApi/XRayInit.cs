using System.Runtime.CompilerServices;
using Amazon.XRay.Recorder.Handlers.AwsSdk;

namespace TransportApi;

// Registers X-Ray instrumentation for all AWS SDK clients (DynamoDB, S3, CloudWatch, ...)
// constructed anywhere in this assembly. Must run before any such client is created —
// a static constructor on Function can't guarantee that ordering against its own field
// initializers, so this uses a module initializer, which the runtime guarantees runs
// before any type in the assembly is first touched.
internal static class XRayInit
{
    [ModuleInitializer]
    internal static void Register() => AWSSDKHandler.RegisterXRayForAllServices();
}
