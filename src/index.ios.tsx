import { NativeModules, NativeEventEmitter } from 'react-native';
import type { ReactNativeHealthkit } from './types';
import type {
  HKQuantityTypeIdentifier,
  HKUnit,
  HKBloodType,
  HKBiologicalSex,
  HKFitzpatrickSkinType,
  HKCharacteristicTypeIdentifier,
  WritePermssions,
  ReadPermssions,
  HKAuthorizationRequestStatus,
  QuantitySampleRaw,
  QuantitySample,
  TypeToUnitMapping,
  StatsResponseRaw,
  HKStatisticsOptions,
  HKWheelchairUse,
} from './types';
import { useState, useEffect } from 'react';

type ReactNativeHealthkitTypeNative = {
  isHealthDataAvailable(): Promise<boolean>;
  getBloodType(): Promise<HKBloodType>;
  getDateOfBirth(): Promise<string>;
  getBiologicalSex(): Promise<HKBiologicalSex>;
  getFitzpatrickSkinType(): Promise<HKFitzpatrickSkinType>;
  getWheelchairUse: () => Promise<HKWheelchairUse>;
  observe(identifier: HKQuantityTypeIdentifier, unit: HKUnit): Promise<string>;
  stopObserving(queryId: string): Promise<boolean>;
  authorizationStatusFor(
    type: HKQuantityTypeIdentifier | HKCharacteristicTypeIdentifier
  ): Promise<boolean>;
  getRequestStatusForAuthorization(
    write: WritePermssions | {},
    read: ReadPermssions | {}
  ): Promise<HKAuthorizationRequestStatus>;
  requestAuthorization(
    write: WritePermssions | {},
    read: ReadPermssions | {}
  ): Promise<boolean>;
  save: (
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    value: number,
    start: string,
    end: string,
    metadata: any
  ) => Promise<boolean>;
  getLastSamples: (
    identifier: HKQuantityTypeIdentifier,
    limit: number,
    unit: HKUnit
  ) => Promise<QuantitySampleRaw[]>;
  getSamplesBetween: (
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    from: string,
    to: string
  ) => Promise<QuantitySampleRaw[]>;
  getStatsBetween: (
    identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    from: string,
    to: string,
    options: HKStatisticsOptions[]
  ) => Promise<StatsResponseRaw>;
  getPreferredUnits: (
    identifiers: [HKQuantityTypeIdentifier]
  ) => Promise<TypeToUnitMapping>;
};

const Native = NativeModules.ReactNativeHealthkit as ReactNativeHealthkitTypeNative;

const getPreferredUnit = async (type: HKQuantityTypeIdentifier) => {
  const unit = await Native.getPreferredUnits([type]);
  return unit[type];
};

const deserializeSample = (sample: QuantitySampleRaw): QuantitySample => {
  return {
    ...sample,
    startDate: new Date(sample.startDate),
    endDate: new Date(sample.endDate),
  };
};

const HealthkitEmitter = new NativeEventEmitter(
  NativeModules.ReactNativeHealthkit
);

const getLastSamples = async (
  identifier: HKQuantityTypeIdentifier,
  limit: number = 1,
  unit?: HKUnit
) => {
  let actualUnit = unit || (await getPreferredUnit(identifier));
  const samples = await Native.getLastSamples(identifier, limit, actualUnit);
  return samples.map((s) => deserializeSample(s));
};

const on = async (
  identifier: HKQuantityTypeIdentifier,
  callback: (samples: QuantitySample[]) => void,
  unit?: HKUnit
) => {
  let actualUnit = unit || (await getPreferredUnit(identifier));
  const listener = ({
    samples,
    typeIdentifier,
  }: {
    samples: QuantitySampleRaw[];
    typeIdentifier: HKQuantityTypeIdentifier;
  }) => {
    if (typeIdentifier === identifier) {
      callback(samples.map(deserializeSample));
    }
  };
  const subscription = HealthkitEmitter.addListener('onQueryUpdated', listener);

  const queryId = await Native.observe(identifier, actualUnit).catch(
    (error) => {
      subscription.remove();
      return Promise.reject(error);
    }
  );
  return () => {
    subscription.remove();
    return Native.stopObserving(queryId);
  };
};

const getLastSample = async (
  identifier: HKQuantityTypeIdentifier,
  unit?: HKUnit
) => {
  const samples = await getLastSamples(identifier, 1, unit);
  return samples[0];
};

const useLastSample = (identifier: HKQuantityTypeIdentifier, unit?: HKUnit) => {
  const [lastSample, setLastSample] = useState<QuantitySample | null>(null);

  useEffect(() => {
    let cancelSubscription: (() => Promise<boolean>) | null = null;

    const init = async () => {
      let actualUnit = unit || (await getPreferredUnit(identifier));

      getLastSample(identifier, actualUnit).then(setLastSample);

      cancelSubscription = await on(
        identifier,
        (samples) => {
          const sample = samples[samples.length - 1];
          setLastSample(sample);
        },
        actualUnit
      );
    };
    init();

    return () => {
      if (cancelSubscription) {
        cancelSubscription();
      }
    };
  }, [identifier, unit]);

  return lastSample;
};

const save = (
  identifier: HKQuantityTypeIdentifier,
  unit: HKUnit,
  value: number,
  options?: {
    start?: Date;
    end?: Date;
    metadata?: any;
  }
) => {
  const start = options?.start || options?.end || new Date();
  const end = options?.end || options?.start || new Date();
  const metadata = options?.metadata || {};

  return Native.save(
    identifier,
    unit,
    value,
    start.toISOString(),
    end.toISOString(),
    metadata
  );
};

const getStatsBetween = async (
  identifier: HKQuantityTypeIdentifier,
  options: HKStatisticsOptions[],
  from: Date,
  to?: Date,
  unit?: HKUnit
) => {
  const actualUnit = unit || (await getPreferredUnit(identifier));
  const toDate = to || new Date();
  const {
    mostRecentQuantityDateInterval,
    ...rawResponse
  } = await Native.getStatsBetween(
    identifier,
    actualUnit,
    from.toISOString(),
    toDate.toISOString(),
    options
  );

  const response = {
    ...rawResponse,
    ...(mostRecentQuantityDateInterval
      ? {
          mostRecentQuantityDateInterval: {
            from: new Date(mostRecentQuantityDateInterval.from),
            to: new Date(mostRecentQuantityDateInterval.to),
          },
        }
      : {}),
  };

  return response;
};

const requestAuthorization = (
  read: (HKCharacteristicTypeIdentifier | HKQuantityTypeIdentifier)[],
  write: HKQuantityTypeIdentifier[] = []
): Promise<boolean> => {
  const readPermissions = read.reduce((obj, cur) => {
    return { ...obj, [cur]: true };
  }, {});

  const writePermissions = write.reduce((obj, cur) => {
    return { ...obj, [cur]: true };
  }, {});

  return Native.requestAuthorization(writePermissions, readPermissions);
};

const getDateOfBirth = async () => {
  const dateOfBirth = await Native.getDateOfBirth();
  return new Date(dateOfBirth);
};

const getSamplesBetween = async (
  identifier: HKQuantityTypeIdentifier,
  unit: HKUnit,
  from: Date,
  to: Date = new Date()
) => {
  const samples = await Native.getSamplesBetween(
    identifier,
    unit,
    from.toISOString(),
    to.toISOString()
  );
  return samples.map(deserializeSample);
};

const getRequestStatusForAuthorization = (
  read: (HKCharacteristicTypeIdentifier | HKQuantityTypeIdentifier)[],
  write: HKQuantityTypeIdentifier[] = []
) => {
  const readPermissions = read.reduce((obj, cur) => {
    return { ...obj, [cur]: true };
  }, {});

  const writePermissions = write.reduce((obj, cur) => {
    return { ...obj, [cur]: true };
  }, {});

  return Native.getRequestStatusForAuthorization(
    writePermissions,
    readPermissions
  );
};

const Healthkit: ReactNativeHealthkit = {
  ...Native,
  getDateOfBirth,
  getLastSample,
  getLastSamples,
  getPreferredUnit,
  getRequestStatusForAuthorization,
  getSamplesBetween,
  getStatsBetween,
  on,
  requestAuthorization,
  save,
  useLastSample,
};

export default Healthkit;
