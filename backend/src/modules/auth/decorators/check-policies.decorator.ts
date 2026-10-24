// Moved to common so modules below `auth` can declare policies (D-061); kept here for existing imports.
export {
  CHECK_POLICIES_KEY,
  CheckPolicies,
  type PolicyHandler,
} from '../../../common/decorators/access.decorator';
