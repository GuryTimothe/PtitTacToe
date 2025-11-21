import {TokenColor} from './Enum/token-color';

export interface IUser {
  username: string;
  guid: string;
  color: TokenColor;
}
